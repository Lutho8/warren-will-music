# Administrator access and Warren's team priorities

Administrator privileges are granted only by an active management entry with the server-owned `admin` scope in `crm_user_roles`. The account remains management rather than impersonating the artist. Client-supplied flags and editable profile metadata never grant administrator access. Existing team-only accounts and read-only Warren scopes keep their permissions.

The administrator can use the Team board and Warren layout, add/edit board items, and remove items through the recoverable archive. Warren layout includes all Warren board items and restore controls. Team task removal checks the task version and logs the administrator's user ID. Existing invoice, delivery and payment-state safeguards remain enforced; no bank transaction is triggered by this change.

Warren's Today page derives up to three active shared tasks for each active team-directory member from the same client_board records used by Team view. Sort order: priority high/normal/low, then nearest due date, then creation time and ID for stable ties. Completed, approved, declined, archived and private records are excluded. In-review and blocked active tasks remain visible; unknown/unassigned assignees are counted explicitly rather than guessed. The query is capped at the latest 1,000 shared records and displays a notice at that limit.

Priority cards open the original team ticket. The view refreshes every 30 seconds while visible, when returning to the window, after local task changes, and on manual refresh. Automatic refresh pauses while either task editor is open to preserve drafts. This is a refreshed view of one data source, not two-way copying or instantaneous realtime transport.

Verification: 71 non-browser tests, plus browser inspection of an administrator's Warren task controls and opening the original shared task from the per-member summary, using fictional local data. Live sign-in and actual email delivery are not claimed as tested.
