import type { ResourceRegistry } from '../resource/registry.js'
import { ADULA_VERSION } from '../version.js'
import { WORKFLOW_NAME_RULE } from '../workflows/define_workflow.js'
import { ACTOR_ID } from '../auth/conditions.js'

/** Field kinds accepted by defineResource, with their storage. */
export const FIELD_TYPES: Record<string, string> = {
  string: 'varchar(255); min/max length, pattern, format email/url/phone',
  text: 'text; min/max length, pattern',
  integer: 'integer; min/max',
  money: 'bigint minor units, decimal string in JSON; min/max in minor units',
  decimal: 'numeric(precision 18, scale 2 by default); canonical decimal string ("12.50"); min/max',
  percent: 'numeric(precision 7, scale 2 by default); 12.5 means 12.5 %; min/max',
  email: 'varchar(254), trimmed and lower-cased',
  phone: 'varchar(32), stored as +?digits (7 to 15 digits)',
  url: 'varchar(2048), absolute http(s) URLs only',
  enum: 'varchar; one of options [{ value, label }]',
  multiSelect: 'jsonb array of option values in options order; min/max count; filter contains',
  manyToMany: 'join table <owner>_<key> (or table), array of target ids; targets must be viewable',
  boolean: 'boolean',
  date: 'date (YYYY-MM-DD)',
  datetime: 'timestamptz',
  json: 'jsonb',
  attachment:
    'attachments row id; per-file accept/maxSize; multiple: true (max, default 10) stores an ordered jsonb array of ids; images, PDF and text preview inline',
  belongsTo: 'foreign key, preloaded, restrict on delete',
  user: 'users foreign key, restrict on delete; choices are active members of the record unit or its ancestors; related as { id, fullName }',
  hasMany: 'child resource; inline rows saved with the parent',
  lookup: 'lookups group key',
}
export const FIELD_OPTIONS = [
  'required',
  'unique (partial, active rows)',
  'sortable',
  'searchable (generated tsvector)',
  'filterable',
  'permissionLevel',
  'sequence',
  'column',
  'default (create prefill, server default and column default)',
  'visibleWhen ({ sibling: value | values }; hidden fields are stored empty and not required)',
  'min / max (length, numeric limit or count)',
  'pattern (anchored RegExp source)',
  'format (string: email, url or phone)',
  'precision / scale (decimal, percent)',
  'options (enum, multiSelect)',
  'resource / table (manyToMany)',
]
export const RESOURCE_OPTIONS = [
  'scoped (required)',
  'scope.from (the unit follows a required belongsTo parent)',
  'title (fields that name the record in relations, pickers, tasks and approvals)',
  'submittable (docStatus, submit/cancel/amend-by-copy)',
  'version (optimistic locking, default with submittable)',
  'unique (composite combinations of fields, partial over active rows)',
  'list / form / show / serialize / hidden',
  'actions',
  'hooks.beforeSave / hooks.afterSave',
  'validator / model (optional: without validator a VineJS validator is derived from the fields)',
]
export const CONDITION_OPERATORS = ['$eq', '$ne', '$in', '$lt', '$gt', '$like']
export const WORKFLOW_STEPS = [
  'condition',
  'update',
  'notify',
  'approval',
  'decision',
  'delay',
  'http',
  'end',
]

/**
 * AdulaJS services by concern. Every name is a public export of adula; a test
 * checks this list against the package entry so the catalog cannot drift.
 */
export const SERVICES: Record<string, string[]> = {
  'Resources and authorization': [
    'defineResource',
    'ResourceRegistry',
    'ResourceService',
    'createResourceController',
    'buildAbility',
    'accessibleBy',
    'ActorStore',
    'packedResourceRules',
  ],
  'Records and collaboration': [
    'RecordCollaboration',
    'followerListeners',
    'Assignments',
    'SavedViews',
    'logActivity',
  ],
  'Documents and workflows': [
    'defineWorkflow',
    'WorkflowEngine',
    'workflowListeners',
    'WorkflowDelegations',
  ],
  'Notifications and messages': [
    'notify',
    'notifyWithTemplate',
    'MessageTemplates',
    'deliverNotificationMail',
    'listenForNotifications',
    'NotificationsAdmin',
  ],
  'Integration': [
    'Webhooks',
    'signWebhook',
    'InboundWebhooks',
    'openApiDocument',
    'apiClientSource',
    'ImportBatches',
    'renderPrintHtml',
    'htmlToPdf',
  ],
  'Security': ['UserInvitations', 'UsersAdmin', 'RolesAdmin'],
  'Data and operations': [
    'sequence',
    'Settings',
    'SettingsAdmin',
    'publishOutbox',
    'consumeEvent',
    'recordMutation',
    'moveOrgUnit',
    'migrateStorage',
    'verifyBackup',
    'runtimeHealth',
  ],
}
export const EXTENSION_POINTS = [
  'Resource hooks (beforeSave, afterSave) inside the save transaction',
  'ResourceService.systemSave for module-decided writes (validator, hooks and audit, no role rules); ResourceService.rehome after a parent moves',
  'Assignment closing notes (Assignments closeNote: optional or required); managed assignments (managed: true) closed by module code with Assignments.close',
  'Page override: inertia/pages/<resource>/{index,form,show}.tsx replaces the generated page',
  'Create links with defaults: /resources/<resource>/create?defaults[field]=value',
  'Domain events <module>.<resource>.{created,updated,deleted,submitted,cancelled,amended} with idempotent listeners',
  'Module workflows (Module.workflows) with versioned definitions',
  'Approval delegation while out of office (WorkflowDelegations; never widens record access)',
  'Step SLA deadlines (sla: hours, dueSoonHours, escalate overdue | notify | reassign, to a recipient or { manager: roleKey }) evaluated by the sla:evaluate job',
  'Message templates edited per deployment',
  'Outgoing webhooks and the bearer-token /api/v1 API',
  'Typed API client of the bearer-token API: GET /api/v1/client.ts per token, or node ace adula:client into clients/<system>/',
  'Signed inbound webhooks raising inbound.<source>.<event> through the outbox',
]
export const OUTSIDE_ADULAJS = [
  'Dynamic fields or a field editor screen',
  'Runtime plugins',
  'A visual workflow editor',
  'Multi-tenant SaaS in one database (one deployment per organization)',
  'XLSX import until a maintained parser passes the dependency rule (GAP-006)',
]

/** The capability catalog read by idea-review: generated, never hand-edited. */
export function capabilityCatalog(
  options: { registry?: ResourceRegistry; commands?: string[] } = {}
) {
  const lines = [
    `# AdulaJS capabilities (${ADULA_VERSION})`,
    '',
    'Generated by `node ace adula:capabilities`. Read this before proposing an application (a module under app/modules); anything not listed here is not provided by AdulaJS.',
    '',
    '## Resource definition',
    '',
    '| Field type | Storage |',
    '|---|---|',
    ...Object.entries(FIELD_TYPES).map(([type, storage]) => `| ${type} | ${storage} |`),
    '',
    `Field options: ${FIELD_OPTIONS.join(', ')}.`,
    '',
    `Resource options: ${RESOURCE_OPTIONS.join(', ')}.`,
    '',
    `Role rule conditions: ${CONDITION_OPERATORS.join(', ')} on scalar fields; unsupported conditions are refused. Organization scope is always added with AND. \`${ACTOR_ID}\` names the signed-in user on user fields, createdBy and updatedBy ($eq, $ne, $in), bound per request.`,
    '',
    `Workflow steps: ${WORKFLOW_STEPS.join(', ')}. Workflow and step names: ${WORKFLOW_NAME_RULE} (for example release_approval, notify_approved).`,
    '',
    '## Services',
    '',
    ...Object.entries(SERVICES).map(
      ([area, names]) => `- **${area}:** ${names.map((name) => `\`${name}\``).join(', ')}`
    ),
    '',
    '## Extension points',
    '',
    ...EXTENSION_POINTS.map((point) => `- ${point}`),
    '',
    '## Outside AdulaJS',
    '',
    ...OUTSIDE_ADULAJS.map((point) => `- ${point}`),
  ]
  if (options.commands?.length)
    lines.push('', '## Commands', '', ...options.commands.map((command) => `- \`${command}\``))
  if (options.registry) {
    lines.push('', '## This project', '')
    const modules = options.registry.modules()
    if (!modules.length) lines.push('No modules are registered yet.')
    for (const module of modules) {
      lines.push(`### ${module.name} — ${module.label.ar}`, '')
      if (module.dependsOn.length) lines.push(`Depends on: ${module.dependsOn.join(', ')}`, '')
      for (const resource of module.resources)
        lines.push(
          `- \`${resource.name}\` (${resource.label.ar}; ${resource.scoped ? 'scoped' : 'central'}${resource.submittable ? ', submittable' : ''}): ${Object.entries(
            resource.fields
          )
            .map(
              ([key, field]) =>
                `${key}:${field.type}${'resource' in field ? `→${field.resource}` : ''}`
            )
            .join(', ')}`
        )
      for (const workflow of module.workflows ?? [])
        lines.push(
          `- workflow \`${workflow.name}@${workflow.version}\` on ${workflow.resource}: ${Object.keys(workflow.steps).join(' → ')}`
        )
      lines.push('')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}
