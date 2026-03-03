import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import App from './App.jsx';

// Mock useSignaling so child views don't open real WebSocket connections.
vi.mock('./hooks/useSignaling.js', () => ({
  useSignaling: vi.fn(() => ({ send: vi.fn(), connected: false })),
}));

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  );
}

describe('App routing', () => {
  test('landing renders at /', () => {
    renderAt('/');
    expect(screen.getByText('Stream Audio, Peer-to-Peer')).toBeInTheDocument();
  });

  test('clicking "Host a Session" navigates to HostView', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByText('Host a Session'));
    // HostView shows this title in its card
    expect(screen.getByText('Host Session')).toBeInTheDocument();
  });

  test('clicking "Listen In" navigates to PeerView', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.click(screen.getByText('Listen In'));
    // PeerView shows this title in its card
    expect(screen.getByText('Listener')).toBeInTheDocument();
  });

  test('logo click from /host returns to landing', async () => {
    const user = userEvent.setup();
    renderAt('/host');
    await user.click(screen.getByText('JamLink'));
    expect(screen.getByText('Stream Audio, Peer-to-Peer')).toBeInTheDocument();
  });

  test('navigating to /listen/ABCXYZ renders PeerView with room code pre-filled', () => {
    renderAt('/listen/ABCXYZ');
    expect(screen.getByText('Listener')).toBeInTheDocument();
    expect(screen.getByDisplayValue('ABCXYZ')).toBeInTheDocument();
  });
});
