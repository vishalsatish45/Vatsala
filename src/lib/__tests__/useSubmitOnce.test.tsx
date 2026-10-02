import { act, create } from 'react-test-renderer';

import { useSubmitOnce } from '../useSubmitOnce';

type Api = ReturnType<typeof useSubmitOnce>;

function mount(stage?: string) {
  const api: { current?: Api } = {};
  function Probe({ s }: { s?: string }) {
    api.current = useSubmitOnce(s);
    return null;
  }
  let root!: ReturnType<typeof create>;
  act(() => {
    root = create(<Probe s={stage} />);
  });
  return { api, rerender: (s?: string) => act(() => root.update(<Probe s={s} />)) };
}

describe('useSubmitOnce', () => {
  it('runs one write per intent, even for taps before a re-render', () => {
    const { api } = mount();
    const write = jest.fn();
    const press = api.current!.once(write);
    act(() => {
      press();
      press();
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(api.current!.busy).toBe(true);
    act(() => api.current!.once(write)());
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('unlocks when the stage moves on (e.g. the referral status changed)', () => {
    const { api, rerender } = mount('requested');
    const write = jest.fn();
    act(() => api.current!.once(write)());
    rerender('accepted');
    expect(api.current!.busy).toBe(false);
    act(() => api.current!.once(write)());
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('next() opens a new intent after a form is reset, while a queued tap from before stays dropped', () => {
    const { api } = mount();
    const write = jest.fn();
    const stale = api.current!.once(write);
    act(() => {
      stale();
      api.current!.next();
    });
    act(() => stale());
    expect(write).toHaveBeenCalledTimes(1);
    act(() => api.current!.once(write)());
    expect(write).toHaveBeenCalledTimes(2);
  });
});
