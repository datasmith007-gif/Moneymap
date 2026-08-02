import { useState } from 'react';

/**
 * Asks for a protected PDF's password. Lifted out of `App.tsx` unchanged when the
 * app grew a second page; the copy about what happens to the password is the
 * point of the component, not decoration.
 */
export function PasswordPrompt({
  message,
  onSubmit,
}: {
  readonly message: string;
  readonly onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState('');

  return (
    <section className="panel">
      <header className="panel-head">
        <h2>Password needed</h2>
      </header>
      <p>{message}</p>
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
          setPassword(''); // used for this parse only; never retained or stored
        }}
      >
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Statement password"
          aria-label="Statement password"
          autoComplete="off"
        />
        <button type="submit" disabled={password === ''}>
          Unlock and parse
        </button>
      </form>
      <p className="drop-note">
        Used in memory to decrypt this file only. Never stored, never logged, never sent anywhere.
      </p>
    </section>
  );
}
