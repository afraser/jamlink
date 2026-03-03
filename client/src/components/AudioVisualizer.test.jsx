import { render } from '@testing-library/react';
import AudioVisualizer from './AudioVisualizer.jsx';

// A minimal fake MediaStream — AudioVisualizer only calls
// createMediaStreamSource(stream), so the object doesn't need real tracks.
const fakeStream = { getTracks: () => [] };

describe('AudioVisualizer', () => {
  test('renders a <canvas> element', () => {
    render(<AudioVisualizer stream={fakeStream} />);
    expect(document.querySelector('canvas')).toBeInTheDocument();
  });

  test('creates an AudioContext and connects the stream source on mount', () => {
    render(<AudioVisualizer stream={fakeStream} />);

    expect(window.AudioContext).toHaveBeenCalled();
    const ctx = window.AudioContext.mock.results[0].value;
    expect(ctx.createMediaStreamSource).toHaveBeenCalledWith(fakeStream);
    // source is connected to the analyser
    const source = ctx.createMediaStreamSource.mock.results[0].value;
    expect(source.connect).toHaveBeenCalled();
  });

  test('disconnects source and closes AudioContext on unmount', () => {
    const { unmount } = render(<AudioVisualizer stream={fakeStream} />);

    const ctx    = window.AudioContext.mock.results[0].value;
    const source = ctx.createMediaStreamSource.mock.results[0].value;

    unmount();

    expect(source.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });
});
