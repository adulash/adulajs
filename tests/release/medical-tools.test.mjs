import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateResource } from '../../packages/adula/build/src/commands/generator.js'
import { installMedicalModule } from '../medical-consumer/install.mjs'
import { resources } from '../medical-consumer/resources.mjs'

test('packed creator module entrypoint supports generating and specializing an independent module', async () => {
  const target = await mkdtemp(join(tmpdir(), 'adula-medical-scaffold-'))
  try {
    const { files } = JSON.parse(await readFile(new URL('../../packages/create-adulajs/build/template.json', import.meta.url)))
    await mkdir(join(target, 'start'))
    await mkdir(join(target, 'docs'))
    await writeFile(join(target, 'start/modules.ts'), files['start/modules.ts'])
    for (const resource of resources) await generateResource(target, resource.name, 'medical')
    await installMedicalModule(target)
    const source = await readFile(join(target, 'start/modules.ts'), 'utf8')
    assert.equal(source.match(/import module_medical /g)?.length, 1)
    for (const resource of resources) {
      const text = await readFile(join(target, `app/modules/medical/resources/${resource.name}.ts`), 'utf8')
      assert(text.includes(resource.label.ar))
      assert.match(await readFile(join(target, `tests/functional/${resource.name}.spec.ts`), 'utf8'), /medicalFixture/)
    }
    await assert.rejects(installMedicalModule(target), /customized resource/)
  } finally { await rm(target, { recursive: true, force: true }) }
})
