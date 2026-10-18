import vine from '@vinejs/vine'

const day = () => vine.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const validator = vine.create({
  employee: vine.number().positive().withoutDecimals(),
  startDate: day(),
  endDate: day(),
  reason: vine.string().trim().maxLength(10000).nullable().optional(),
  status: vine.string().trim().minLength(1).maxLength(100).nullable().optional(),
})
