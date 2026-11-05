import drive from '@adonisjs/drive/services/main'
import db from '@adonisjs/lucid/services/db'

/**
 * Removes test uploads completely: their files on every disk, the references that point to
 * them and their rows. Deleting only the files would leave rows whose files are gone, and a
 * later backup snapshot in the same run fails on them, as ADR 023 requires.
 */
export async function removeAttachments(ids: number[], disks: string[] = ['local']) {
  if (!ids.length) return
  const knex = db.connection().getWriteClient()
  const rows = await knex('attachments').whereIn('id', ids)
  for (const row of rows)
    for (const disk of disks)
      await drive
        .use(disk as Parameters<typeof drive.use>[0])
        .delete(row.path)
        .catch(() => {})
  // Single attachment fields reference attachments(id) with ON DELETE RESTRICT.
  const references = await knex.raw<{ rows: { table: string; column: string }[] }>(`
    SELECT cl.relname AS table, att.attname AS column
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.contype = 'f' AND con.confrelid = 'attachments'::regclass
  `)
  for (const { table, column } of references.rows)
    await knex(table)
      .whereIn(column, ids)
      .update({ [column]: null })
  await knex('attachments').whereIn('id', ids).delete()
}
