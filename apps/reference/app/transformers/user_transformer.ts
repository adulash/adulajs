import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserTransformer extends BaseTransformer<User> {
  toObject() {
    return {
      ...this.pick(this.resource, [
        'id',
        'fullName',
        'email',
        'createdAt',
        'updatedAt',
        'initials',
      ]),
      // Versioned profile picture URL (ADR 050), loaded by the caller into $extras; null shows initials.
      avatarUrl: (this.resource.$extras.avatarUrl as string | null | undefined) ?? null,
    }
  }
}
