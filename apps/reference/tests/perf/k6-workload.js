// Explicit independent-consumer fixture; no normal-runtime educational modules.
// Run by .github/workflows/performance.yml. This measures list/save, not cached Ability.
import http from 'k6/http'
import execution from 'k6/execution'
import { check, sleep } from 'k6'
import { Trend, Counter } from 'k6/metrics'
import { validateFixture, createWorkload } from './workload.mjs'

const fixture = JSON.parse(open(__ENV.PERF_FIXTURE))
const vus = Number(__ENV.VUS || 50)
validateFixture(fixture, vus)
const listLatency = new Trend('list_with_relations', true)
const saveLatency = new Trend('form_save', true)
const lists = new Counter('successful_lists')
const saves = new Counter('successful_saves')

export const options = {
  noCookiesReset: true,
  scenarios: {
    workload: { executor: 'constant-vus', vus, duration: __ENV.DURATION || '3m' },
  },
  thresholds: {
    checks: ['rate==1'],
    list_with_relations: ['p(95)<300'],
    form_save: ['p(95)<200'],
    successful_lists: [`count>=${vus}`],
    successful_saves: [`count>=${vus}`],
    http_req_failed: ['rate<0.01'],
  },
}

// k6 initializes this state separately in every VU, with its own cookie jar.
const run = createWorkload(fixture, {
  http,
  check,
  sleep,
  abort: (message) => execution.test.abort(message),
  listLatency,
  saveLatency,
  lists,
  saves,
})

export default function () {
  run(execution.vu.idInTest, execution.scenario.iterationInTest)
}
