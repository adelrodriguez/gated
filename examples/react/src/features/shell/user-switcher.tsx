import { switchUser } from "#features/shell/server/functions"
import { USERS, type SelectedUser } from "#shared/flags"

export function UserSwitcher({ selected }: { selected: SelectedUser }) {
  return (
    <form action={switchUser} className="user-switcher">
      <label htmlFor="user">Identity</label>
      <select id="user" name="user" defaultValue={selected}>
        {USERS.map((user) => (
          <option key={user} value={user}>
            {user[0].toUpperCase() + user.slice(1)}
          </option>
        ))}
        <option value="anonymous">Anonymous</option>
      </select>
      <button className="button" type="submit">
        Switch
      </button>
    </form>
  )
}
