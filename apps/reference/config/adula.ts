/**
 * AdulaJS settings of this system.
 *
 * `languages`: the interface languages a user may choose on the profile page.
 * Arabic is the base language of every system and is always available; other
 * languages are optional. The framework bundles English for its own strings; to
 * offer it, write `languages: ['ar', 'en']`. Consumer resources show `label.en`
 * when they define it and their Arabic label otherwise. See docs/languages.md.
 *
 * `timeZone` and `attachments`: see below.
 */
const adulaConfig: {
  languages: string[]
  timeZone: string
  attachments: { pdfPreview: boolean }
} = {
  languages: ['ar'],
  /**
   * The system's time zone (an IANA name). Workflow due dates and approval delegation
   * ranges are calendar days in this zone, so a day starts at local midnight rather
   * than at 00:00 UTC (ADR 044). Times are still stored in UTC.
   */
  timeZone: 'Asia/Riyadh',
  /**
   * Attachment previews (ADR 047). Images and plain text always open in the preview
   * dialog. `pdfPreview: false` turns inline PDF previews off: PDFs then only download,
   * for systems whose policy forbids showing PDFs in the browser's own viewer.
   */
  attachments: { pdfPreview: true },
}

export default adulaConfig
