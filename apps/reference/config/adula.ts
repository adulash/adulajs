/**
 * AdulaJS settings of this system.
 *
 * `languages`: the interface languages a user may choose on the profile page.
 * Arabic is the base language of every system and is always available; other
 * languages are optional. The framework bundles English for its own strings; to
 * offer it, write `languages: ['ar', 'en']`. Consumer resources show `label.en`
 * when they define it and their Arabic label otherwise. See docs/languages.md.
 */
const adulaConfig: { languages: string[] } = {
  languages: ['ar'],
}

export default adulaConfig
