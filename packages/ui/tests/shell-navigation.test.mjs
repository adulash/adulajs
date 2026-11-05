import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyOrder,
  effectiveLayout,
  groupModules,
  isActivePath,
  move,
  replaceGroupOrder,
} from '../../../apps/reference/inertia/components/shell_navigation.ts'
import {
  adminSections,
  sectionFor,
  visibleSections,
} from '../../../apps/reference/inertia/components/admin_sections.ts'
import { moduleIcons } from '../../../apps/reference/inertia/components/module_icons.ts'

const icon = () => null
const ids = (list) => list.map((entry) => entry.id)
const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

test('the user order comes first; unknown and invisible ids are ignored (#157)', () => {
  assert.deepEqual(ids(applyOrder(entries, ['c', 'a'])), ['c', 'a', 'b', 'd'])
  // A stored id the user may not see (or that no longer exists) never adds an entry.
  assert.deepEqual(ids(applyOrder(entries, ['module.payroll', 'd', 'd'])), ['d', 'a', 'b', 'c'])
  assert.deepEqual(applyOrder([], ['a']), [])
})

test('each arrangement list saves without disturbing the others', () => {
  assert.deepEqual(
    replaceGroupOrder(
      ['work.imports', 'module.sales', 'admin.people'],
      ['module.sales', 'module.hr'],
      ['module.hr', 'module.sales']
    ),
    ['work.imports', 'admin.people', 'module.hr', 'module.sales']
  )
  assert.deepEqual(move(['a', 'b', 'c'], 0, -1), ['a', 'b', 'c'])
  assert.deepEqual(move(['a', 'b', 'c'], 2, 1), ['a', 'b', 'c'])
  assert.deepEqual(move(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'])
})

test('the layout follows the system unless the system lets users choose (#154)', () => {
  assert.equal(effectiveLayout(undefined, 'top'), 'sidebar')
  assert.equal(effectiveLayout({ layout: 'top' }, 'sidebar'), 'top')
  assert.equal(effectiveLayout({ layout: 'top', layoutUserChoice: true }, 'sidebar'), 'sidebar')
  assert.equal(effectiveLayout({ layoutUserChoice: true }, 'top'), 'top')
  assert.equal(effectiveLayout({ layout: 'top', layoutUserChoice: true }, null), 'top')
})

test('resource links group by module in the server order', () => {
  const groups = groupModules([
    { name: 'customers', label: 'العملاء', href: '/resources/customers', module: 'sales' },
    { name: 'staff', label: 'الموظفون', href: '/resources/staff', module: 'hr', moduleLabel: 'الموارد' },
    { name: 'orders', label: 'الطلبات', href: '/resources/orders', module: 'sales' },
  ])
  assert.deepEqual(
    groups.map((group) => [group.id, group.label, group.links.map((link) => link.name)]),
    [
      ['module.sales', 'sales', ['customers', 'orders']],
      ['module.hr', 'الموارد', ['staff']],
    ]
  )
})

test('active paths match the page and its children, not a longer name', () => {
  assert.equal(isActivePath('/resources/orders?page=2', '/resources/orders'), true)
  assert.equal(isActivePath('/resources/orders/7', '/resources/orders'), true)
  assert.equal(isActivePath('/resources/orders_archive', '/resources/orders'), false)
  assert.equal(isActivePath('/', '/'), true)
  assert.equal(isActivePath('/my-tasks', '/'), false)
})

test('administration section and page ids are unique and every page is under /admin', () => {
  assert.equal(new Set(ids(adminSections)).size, adminSections.length)
  for (const section of adminSections) {
    assert.equal(new Set(ids(section.pages)).size, section.pages.length, section.id)
    for (const page of section.pages) assert.match(page.href, /^\/admin\//)
  }
})

test('the longest matching address wins and nested pages keep their sub-tab', () => {
  const sections = [
    {
      id: 'backups',
      title: 'النسخ الاحتياطي',
      icon,
      pages: [
        { id: 'list', href: '/admin/backups', label: 'النسخ', icon },
        { id: 'restore', href: '/admin/backups/restore', label: 'الاستعادة', icon },
      ],
    },
  ]
  assert.equal(sectionFor('/admin/backups/restore?step=2', {}, sections)?.page.id, 'restore')
  assert.equal(sectionFor('/admin/backups/42', {}, sections)?.page.id, 'list')
  assert.equal(sectionFor('/admin/backupsx', {}, sections), null)
  assert.equal(sectionFor('/admin/users/7', {})?.section.id, 'people')
  assert.equal(sectionFor('/admin/settings', {})?.page.id, 'general')
})

test('pages that do not apply are hidden and empty sections disappear', () => {
  const sections = [
    {
      id: 'setup',
      title: 'الإعداد',
      icon,
      pages: [
        {
          id: 'start',
          href: '/admin/setup',
          label: 'البدء',
          icon,
          visible: (props) => Boolean(props.setupPending),
        },
      ],
    },
  ]
  assert.equal(visibleSections({ setupPending: false }, sections).length, 0)
  assert.equal(visibleSections({ setupPending: true }, sections).length, 1)
  assert.equal(sectionFor('/admin/setup', { setupPending: false }, sections), null)
})

test('module groups get distinct icons: the project map first, else stable neutral shapes', () => {
  const sales = () => 'sales'
  const fallbacks = [() => 'a', () => 'b', () => 'c']
  const shapes = (modules, icons = {}) => moduleIcons(modules, icons, fallbacks)
  assert.equal(shapes(['sales', 'stock'], { sales }).get('sales'), sales)
  // Distinct while the shapes last, whatever the names hash to.
  const three = shapes(['inventory', 'payroll', 'fleet'])
  assert.equal(new Set(three.values()).size, 3)
  for (const icon of three.values()) assert.ok(fallbacks.includes(icon))
  // Stable: the same modules get the same shapes in any menu order.
  const again = shapes(['fleet', 'inventory', 'payroll'])
  for (const [module, icon] of three) assert.equal(again.get(module), icon)
  // A mapped icon is not handed to another module.
  const mapped = shapes(['x', 'y'], { x: fallbacks[0] })
  assert.notEqual(mapped.get('y'), fallbacks[0])
  // Inherited object keys are not entries; beyond the set, shapes repeat but always exist.
  assert.ok(fallbacks.includes(shapes(['constructor']).get('constructor')))
  assert.equal(shapes(['a1', 'a2', 'a3', 'a4']).size, 4)
  // The default map and set give the reference modules distinct components.
  const defaults = moduleIcons(['customers', 'orders', 'suppliers', 'tasks', 'ui_samples'])
  assert.equal(new Set(defaults.values()).size, 5)
})
