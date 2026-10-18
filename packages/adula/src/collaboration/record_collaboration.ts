import type { Knex } from 'knex'
import { subject } from '@casl/ability'
import type { Actor, AdulaAbility } from '../auth/ability.js'
import type { ResourceService } from '../admin/resource_service.js'
import type { JsonValue, RecordData, Resource } from '../resource/types.js'
import type { DomainEvent, Listener } from '../events/outbox.js'
import { jsonValue } from '../admin/contracts.js'
import { AdulaError } from '../admin/errors.js'
import { notifyWithTemplate } from '../core/message_templates.js'
import { escapeLike } from '../core/like.js'

export type ActorLoader = { load(id: number): Promise<Actor> }

export type CommentEntry = {
  id: number
  body: string
  authorId: number
  authorName: string | null
  mentions: { id: number; name: string }[]
  createdAt: string
  editedAt: string | null
  own: boolean
}
export type FieldChangeEntry = {
  id: number
  field: string
  before: JsonValue
  after: JsonValue
  actorName: string | null
  createdAt: string
}
export type RecordCollaborationState = {
  comments: CommentEntry[]
  hasMoreComments: boolean
  tags: string[]
  following: boolean
  followers: number
  changes: FieldChangeEntry[]
  canComment: boolean
  canTag: boolean
}
export type MentionCandidate = { id: number; name: string }

const BODY_LIMIT = 5000
const MENTION_LIMIT = 20
const TAG_LIMIT = 20
const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,59}$/u

/** Minimum permission level of a field for the current resource definition. */
function fieldLevel(resource: Resource, key: string) {
  return Math.max(
    resource.fields[key]?.permissionLevel ?? 0,
    resource.hidden?.includes(key) ? 1 : 0
  )
}
function readableField(
  resource: Resource,
  record: RecordData,
  ability: AdulaAbility,
  actor: Actor,
  key: string
) {
  const serialized = resource.serialize ?? [...resource.list, ...resource.show]
  return (
    key in resource.fields &&
    serialized.includes(key) &&
    actor.permissionLevel >= fieldLevel(resource, key) &&
    ability.can('view', subject(resource.name, record), key)
  )
}

/**
 * Collaboration around a record: comments with mentions, followers, tags and the
 * per-field change history. Every read and write re-authorizes the record itself
 * through ResourceService, so these features can never widen record access.
 */
export class RecordCollaboration {
  constructor(
    private db: Knex,
    private resources: ResourceService,
    private actors: ActorLoader
  ) {}

  async state(name: string, id: number, actor: Actor): Promise<RecordCollaborationState> {
    const { resource, record, ability } = await this.resources.access(name, id, actor)
    const rows = await this.db('comments as c')
      .leftJoin('users as u', 'u.id', 'c.author_id')
      .where({ 'c.resource': name, 'c.record_id': id })
      .whereNull('c.deleted_at')
      .orderBy('c.id', 'desc')
      .limit(51)
      .select('c.*', 'u.full_name as author_name')
    const page = rows.slice(0, 50)
    const mentions = page.length
      ? await this.db('comment_mentions as m')
          .join('users as u', 'u.id', 'm.user_id')
          .whereIn(
            'm.comment_id',
            page.map((row) => row.id)
          )
          .select('m.comment_id', 'u.id', 'u.full_name')
      : []
    const tags = await this.tags(name, id)
    const follow = await this.db('followers')
      .where({ resource: name, record_id: id })
      .select(
        this.db.raw('count(*)::int as count'),
        this.db.raw('bool_or(user_id = ?) as own', [actor.id])
      )
      .first()
    return {
      comments: page.reverse().map((row) => ({
        id: Number(row.id),
        body: String(row.body),
        authorId: Number(row.author_id),
        authorName: row.author_name ? String(row.author_name) : null,
        mentions: mentions
          .filter((mention) => Number(mention.comment_id) === Number(row.id))
          .map((mention) => ({ id: Number(mention.id), name: String(mention.full_name ?? '') })),
        createdAt: new Date(row.created_at).toISOString(),
        editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
        own: Number(row.author_id) === actor.id,
      })),
      hasMoreComments: rows.length > 50,
      tags,
      following: Boolean(follow?.own),
      followers: Number(follow?.count ?? 0),
      changes: await this.readChanges(resource, record, ability, actor, id),
      canComment: true,
      canTag:
        resource.actions.includes('update') &&
        (await this.resources.permits(name, id, actor, 'update')),
    }
  }

  private async readChanges(
    resource: Resource,
    record: RecordData,
    ability: AdulaAbility,
    actor: Actor,
    id: number
  ): Promise<FieldChangeEntry[]> {
    const rows = await this.db('field_changes as f')
      .join('activities as a', 'a.id', 'f.activity_id')
      .leftJoin('users as u', 'u.id', 'a.actor_id')
      .where({ 'f.resource': resource.name, 'f.record_id': id })
      .orderBy('f.id', 'desc')
      .limit(200)
      .select('f.*', 'a.created_at', 'u.full_name as actor_name')
    // Values are filtered per viewer: a private field's history is as private as the field.
    return rows
      .filter((row) => readableField(resource, record, ability, actor, String(row.field)))
      .slice(0, 100)
      .map((row) => ({
        id: Number(row.id),
        field: String(row.field),
        before: jsonValue(row.before),
        after: jsonValue(row.after),
        actorName: row.actor_name ? String(row.actor_name) : null,
        createdAt: new Date(row.created_at).toISOString(),
      }))
  }

  async comment(
    name: string,
    id: number,
    actor: Actor,
    input: { body: unknown; mentions?: unknown }
  ): Promise<CommentEntry> {
    await this.resources.access(name, id, actor)
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (!body || body.length > BODY_LIMIT)
      throw new AdulaError(422, 'E_COMMENT_BODY', 'نص التعليق مطلوب ولا يتجاوز 5000 حرف')
    const requested = this.userIds(input.mentions)
    // Mentioning someone who cannot read the record would leak it through the notification.
    const mentioned: number[] = []
    for (const userId of requested) {
      if (userId === actor.id) continue
      if (await this.canView(name, id, userId)) mentioned.push(userId)
      else
        throw new AdulaError(
          422,
          'E_MENTION',
          'لا يمكن الإشارة إلى مستخدم لا يملك صلاحية عرض السجل'
        )
    }
    return this.db.transaction(async (trx) => {
      const [row] = await trx('comments')
        .insert({ resource: name, record_id: id, author_id: actor.id, body })
        .returning('*')
      if (mentioned.length)
        await trx('comment_mentions').insert(
          mentioned.map((userId) => ({ comment_id: row.id, user_id: userId }))
        )
      await trx('followers')
        .insert({ resource: name, record_id: id, user_id: actor.id })
        .onConflict(['resource', 'record_id', 'user_id'])
        .ignore()
      const author = await trx('users').where('id', actor.id).first('full_name')
      const authorName = author?.full_name ? String(author.full_name) : `مستخدم #${actor.id}`
      const label = this.label(name)
      for (const userId of mentioned)
        await notifyWithTemplate(
          trx,
          userId,
          'comment.mentioned',
          { author: authorName, resource: label, id, excerpt: body.slice(0, 200) },
          undefined,
          { resource: name, recordId: id }
        )
      const followers = await trx('followers')
        .where({ resource: name, record_id: id })
        .whereNot('user_id', actor.id)
        .whereNotIn('user_id', mentioned.length ? mentioned : [0])
        .pluck('user_id')
      for (const userId of followers) {
        if (!(await this.canView(name, id, Number(userId)))) continue
        await notifyWithTemplate(
          trx,
          Number(userId),
          'comment.created',
          { author: authorName, resource: label, id, excerpt: body.slice(0, 200) },
          undefined,
          { resource: name, recordId: id }
        )
      }
      const names = mentioned.length
        ? await trx('users').whereIn('id', mentioned).select('id', 'full_name')
        : []
      return {
        id: Number(row.id),
        body,
        authorId: actor.id,
        authorName: author?.full_name ? String(author.full_name) : null,
        mentions: names.map((user) => ({
          id: Number(user.id),
          name: String(user.full_name ?? ''),
        })),
        createdAt: new Date(row.created_at).toISOString(),
        editedAt: null,
        own: true,
      }
    })
  }

  /** Authors edit or remove their own comments while they can still read the record. */
  async editComment(name: string, id: number, comment: unknown, actor: Actor, body: unknown) {
    await this.resources.access(name, id, actor)
    const commentId = this.commentId(comment)
    const text = typeof body === 'string' ? body.trim() : ''
    if (!text || text.length > BODY_LIMIT)
      throw new AdulaError(422, 'E_COMMENT_BODY', 'نص التعليق مطلوب ولا يتجاوز 5000 حرف')
    const updated = await this.db('comments')
      .where({ id: commentId, resource: name, record_id: id, author_id: actor.id })
      .whereNull('deleted_at')
      .update({ body: text, edited_at: this.db.fn.now() })
    if (!updated) throw new AdulaError(404, 'E_COMMENT_NOT_FOUND', 'التعليق غير موجود')
  }

  async deleteComment(name: string, id: number, comment: unknown, actor: Actor) {
    await this.resources.access(name, id, actor)
    const commentId = this.commentId(comment)
    const deleted = await this.db('comments')
      .where({ id: commentId, resource: name, record_id: id, author_id: actor.id })
      .whereNull('deleted_at')
      .update({ deleted_at: this.db.fn.now() })
    if (!deleted) throw new AdulaError(404, 'E_COMMENT_NOT_FOUND', 'التعليق غير موجود')
  }

  async follow(name: string, id: number, actor: Actor, following: boolean) {
    await this.resources.access(name, id, actor)
    if (following)
      await this.db('followers')
        .insert({ resource: name, record_id: id, user_id: actor.id })
        .onConflict(['resource', 'record_id', 'user_id'])
        .ignore()
    else
      await this.db('followers').where({ resource: name, record_id: id, user_id: actor.id }).del()
  }

  /** Replaces the record's tags. Tagging changes how a record is found, so it needs update. */
  async setTags(name: string, id: number, actor: Actor, input: unknown) {
    const { resource } = await this.resources.access(name, id, actor)
    if (!resource.actions.includes('update'))
      throw new AdulaError(403, 'E_FORBIDDEN', 'ليس لديك صلاحية لهذا الإجراء')
    await this.resources.access(name, id, actor, 'update')
    if (!Array.isArray(input) || input.length > TAG_LIMIT)
      throw new AdulaError(422, 'E_TAGS', 'الوسوم قائمة لا تتجاوز 20 وسماً')
    const names = [
      ...new Set(
        input.map((tag) => {
          const value = typeof tag === 'string' ? tag.trim() : ''
          if (!TAG_PATTERN.test(value))
            throw new AdulaError(422, 'E_TAGS', 'الوسم حروف وأرقام ومسافات فقط ولا يتجاوز 60 حرفاً')
          return value
        })
      ),
    ]
    await this.db.transaction(async (trx) => {
      if (names.length)
        await trx('tags')
          .insert(names.map((tag) => ({ name: tag })))
          .onConflict('name')
          .ignore()
      const ids = names.length ? await trx('tags').whereIn('name', names).pluck('id') : []
      await trx('taggables').where({ resource: name, record_id: id }).del()
      if (ids.length)
        await trx('taggables').insert(
          ids.map((tagId) => ({ tag_id: tagId, resource: name, record_id: id }))
        )
    })
    return this.tags(name, id)
  }

  async tags(name: string, id: number) {
    const names = await this.db('taggables as t')
      .join('tags', 'tags.id', 't.tag_id')
      .where({ 't.resource': name, 't.record_id': id })
      .orderBy('tags.name')
      .pluck('tags.name')
    return names.map(String)
  }

  /** Tag vocabulary used on records of a resource the actor may list. */
  async tagOptions(name: string, actor: Actor) {
    this.resources.describe(name, actor)
    const names = await this.db('taggables as t')
      .join('tags', 'tags.id', 't.tag_id')
      .where('t.resource', name)
      .distinct('tags.name')
      .orderBy('tags.name')
      .limit(200)
      .pluck('tags.name')
    return names.map(String)
  }

  /** Active users that may read the record, for the mention picker. */
  async mentionCandidates(
    name: string,
    id: number,
    actor: Actor,
    search = ''
  ): Promise<MentionCandidate[]> {
    await this.resources.access(name, id, actor)
    const term = String(search).trim().slice(0, 60)
    const result: MentionCandidate[] = []
    // Readers are filtered per user, so page through candidates until ten readers
    // are found; a bounded scan keeps a large directory from turning into a sweep.
    const page = 100
    for (let offset = 0; result.length < 10 && offset < 2000; offset += page) {
      const query = this.db('users')
        .whereNot('id', actor.id)
        .whereNull('disabled_at')
        .orderBy([{ column: 'full_name' }, { column: 'id' }])
        .offset(offset)
        .limit(page)
        .select('id', 'full_name')
      // Names match by substring; e-mail only by exact (case-insensitive) equality so
      // the picker cannot be used to enumerate addresses prefix by prefix.
      if (term)
        query.where((where) =>
          where
            .whereILike('full_name', `%${escapeLike(term)}%`)
            .orWhereRaw('lower(email) = lower(?)', [term])
        )
      const users = await query
      for (const user of users) {
        if (result.length >= 10) break
        if (await this.canView(name, id, Number(user.id)))
          result.push({ id: Number(user.id), name: String(user.full_name ?? `#${user.id}`) })
      }
      if (users.length < page) break
    }
    return result
  }

  /**
   * Listener factory: followers hear about updates and document transitions of the
   * records they follow, but only while they can still read the record.
   */
  followerListener(module: string, resource: string, event: string): Listener {
    return {
      name: `adula.followers.${module}.${resource}.${event}`,
      event: `${module}.${resource}.${event}`,
      handle: async (domainEvent: DomainEvent, trx: Knex.Transaction) => {
        const id = Number(domainEvent.payload.id)
        const actorId = Number(domainEvent.payload.actorId)
        const followers = await trx('followers')
          .where({ resource, record_id: id })
          .whereNot('user_id', actorId)
          .pluck('user_id')
        const verbs: Record<string, string> = {
          updated: 'تم تعديل',
          submitted: 'تم اعتماد',
          cancelled: 'تم إلغاء',
          deleted: 'تم حذف',
        }
        for (const userId of followers) {
          if (event !== 'deleted' && !(await this.canView(resource, id, Number(userId)))) continue
          await notifyWithTemplate(
            trx,
            Number(userId),
            'record.changed',
            { change: verbs[event] ?? 'تحديث', resource: this.label(resource), id },
            undefined,
            // A deleted record has no page to open.
            event === 'deleted' ? null : { resource, recordId: id }
          )
        }
      },
    }
  }

  private label(name: string) {
    try {
      return this.resources.label(name)
    } catch {
      return name
    }
  }

  private async canView(name: string, id: number, userId: number) {
    const disabled = await this.db('users').where('id', userId).first('disabled_at')
    if (!disabled || disabled.disabled_at) return false
    return this.resources.permits(name, id, await this.actors.load(userId))
  }

  /** Parsed after the record is authorized, so malformed ids never bypass the 403. */
  private commentId(value: unknown) {
    const id = Number(value)
    if (!Number.isSafeInteger(id) || id <= 0)
      throw new AdulaError(404, 'E_COMMENT_NOT_FOUND', 'التعليق غير موجود')
    return id
  }

  private userIds(value: unknown) {
    if (value === undefined || value === null) return []
    if (!Array.isArray(value) || value.length > MENTION_LIMIT)
      throw new AdulaError(422, 'E_MENTION', 'الإشارات قائمة لا تتجاوز 20 مستخدماً')
    return [
      ...new Set(
        value.map((entry) => {
          const id = Number(entry)
          if (!Number.isSafeInteger(id) || id <= 0)
            throw new AdulaError(422, 'E_MENTION', 'معرّف المستخدم غير صالح')
          return id
        })
      ),
    ]
  }
}

/** Follower notifications for every registered resource's update and document events. */
export function followerListeners(
  registry: { all(): Resource[]; owner(name: string): string },
  collaboration: () => RecordCollaboration
): Listener[] {
  return registry.all().flatMap((resource) =>
    ['updated', 'submitted', 'cancelled', 'deleted'].map((event) => {
      const module = registry.owner(resource.name)
      return {
        name: `adula.followers.${module}.${resource.name}.${event}`,
        event: `${module}.${resource.name}.${event}`,
        handle: (domainEvent: DomainEvent, trx: Knex.Transaction) =>
          collaboration().followerListener(module, resource.name, event).handle(domainEvent, trx),
      }
    })
  )
}
