# ADR 035 — Record dialogs over the mounted list (1.2.0)

Date: 2026-09-29. Status: accepted by the owner on 2026-09-30.

Issue #31. Records open in a shadcn Dialog (AGENTS rule), but the dialog was a separate
Inertia page: opening a record replaced the list, and closing it returned to a freshly
loaded list. 1.0.1 restored the list's query, scroll and focus on close; the list was
still unmounted and reloaded, and an edit that was saved left the dialog.

## Decisions

1. From the generic list, the view and edit links call `openRecord(resource, id, mode)`,
   exported by the registry's `resource-surface`. It fetches the record with one request
   to `GET /resources/:resource/:id/view` and pushes a client-side Inertia visit with the
   record URL. In show mode the server reads the record once; in edit mode it reads it
   for the editor and again for the permissions, as the standalone edit page does. The list stays mounted with its query, loaded pages and scroll.
2. Editing and saving inside the dialog replace its history entry, and closing replaces
   it with the list, whether or not the record changed: Back never reopens a record that
   was closed. The list refreshes its rows only when the record changed, and focus
   returns to the row link.
3. Saving an edit turns the dialog into the record's details, over the list and on a
   direct edit URL.
4. A direct record URL still renders the standalone dialog. Its inline children and
   activity arrive in one deferred request served by `ResourceService.details()` from a
   single authorized record read; `ResourceService.record()` returns show, children and
   activity together for the `/view` endpoint.
5. Resources with their own page overrides keep navigating to their pages.

## Consequences

- Projects with copied `data-table`, `resource-form`, `resource-page` or `resource-show`
  need the updated components; `resource-surface` is new in the registry.
- The frontend design skill tells agents to open records with `openRecord` from lists.
- `record()` and `details()` apply the same authorization as `show()`, `children()` and
  `activity()`; kit tests cover both on PostgreSQL, and the reference browser test checks
  that the list keeps its state.

## Amendment (2.3.0): the dialog opens at once, over any page

The owner reported that opening a dialog still rendered the page again and broke the opening
animation: «إضافة» visited `/resources/:resource/create`, which replaced the list's heading and
table with a standalone form, and a record dialog appeared only after its view arrived.

1. `openRecord` pushes the record's address with the dialog's shell first, with no request: the
   dialog's enter animation starts on the click, over the mounted page, and its body shows a
   loading state (shadcn Skeleton) until `GET /resources/:resource/:id/view` answers. A close, a
   newer opening or Back discards a view that arrives late; a view missing after Forward is
   fetched again.
2. «إضافة» calls `openCreate(resource)`, which opens the create form the same way from
   `GET /resources/:resource/create/view`; closing an untouched form returns to the list with
   no request. The direct address `/resources/:resource/create` still renders the standalone
   form, as do reload, Back and Forward.
3. Saving a new record closes the dialog and returns to the list (owner, 2.3.0: the details
   that used to open broke the view, and the new row sat at the list's tail, on a page not
   loaded yet when there are thousands). The list is not loaded again: one request,
   `GET /resources/:resource/:id/row`, reads the record as a row of the list under the list's
   authorization (`ListOptions.ids`), and the row is pinned first and highlighted for a
   moment, whatever the sort. It stays first until the list's query changes. The success toast
   offers «عرض», which opens the record over the list. The standalone create page returns to the
   list the same way. Saving an edit still shows the record's details in the same dialog.
4. `RecordOverlayDialog` (exported by `resource-page`) renders the dialog. ResourcePage renders
   it over the generic list; any page that opens records with `openRecord` renders it too:
   «مهامي», «تدفقات فاشلة» and «التنبيهات» open their records over themselves; the browser sweep
   fails when opening any dialog replaces the page's main content.
5. On a standalone record page, «تعديل السجل» and the form's «إلغاء» keep the page mounted
   (`preserveState`), so the same dialog switches between details and form.
6. The invitation over the users list (`?invite=1`) opens and closes with client-side visits,
   with no request.
7. Inertia renders a history entry afresh on Back and Forward (`preserveState: false`); those
   visits read the history and send no request.
8. Every address change of a dialog goes through `clientVisit` (exported by `resource-surface`).
   Opening a dialog cancels a visit still in flight, as a link click does, so a late answer
   cannot replace the page and the dialog with it. Deferred props (the «مهامي» badge) loading
   for the old address are cancelled when the dialog returns to the page's own address and
   loaded again for it: Inertia would otherwise apply their late answer when only the query
   changed (reopening the invitation) and drop it when the path changed. The bell's refresh on
   a new notification is asynchronous, like its catch-up.
9. The second GET seen after each server visit is that deferred badge count (#156), by design;
   opening a dialog no longer makes a server visit, so it no longer follows the click.
