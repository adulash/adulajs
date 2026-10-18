import env from '#start/env'

/**
 * Sets SIGNUP_ENABLED for one test (undefined = unset, the default policy) and
 * returns the restore function for Japa's cleanup.
 */
export function configureSignup(value: boolean | undefined) {
  const previous = env.get('SIGNUP_ENABLED')
  const apply = (next: boolean | undefined) => {
    env.set('SIGNUP_ENABLED', next)
    // Env.set mirrors into process.env as a string; an unset value must stay absent.
    if (next === undefined) delete process.env.SIGNUP_ENABLED
  }
  apply(value)
  return () => apply(previous)
}
