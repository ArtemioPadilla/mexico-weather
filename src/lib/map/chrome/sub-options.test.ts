// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSubOptionsGroup } from './sub-options';

describe('createSubOptionsGroup', () => {
  type V = 'actual' | 'aparente';
  function mkWrap(): HTMLElement {
    const w = document.createElement('div');
    document.body.appendChild(w);
    return w;
  }

  it('renders one button per option in document order', () => {
    const wrap = mkWrap();
    let active: V = 'actual';
    createSubOptionsGroup<V>(wrap, {
      containerId: 'g',
      getActive: () => active,
      onSelect: (n) => {
        active = n;
      },
      isVisible: () => true,
      options: [
        { id: 'actual', label: 'Actual' },
        { id: 'aparente', label: 'Aparente' },
      ],
    });
    const btns = wrap.querySelectorAll('button');
    expect(btns).toHaveLength(2);
    expect((btns[0] as HTMLButtonElement).dataset.sub).toBe('actual');
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    expect(btns[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('click fires onSelect + flips aria-pressed', () => {
    const wrap = mkWrap();
    let active: V = 'actual';
    createSubOptionsGroup<V>(wrap, {
      containerId: 'g',
      getActive: () => active,
      onSelect: (n) => {
        active = n;
      },
      isVisible: () => true,
      options: [
        { id: 'actual', label: 'Actual' },
        { id: 'aparente', label: 'Aparente' },
      ],
    });
    const btns = wrap.querySelectorAll('button');
    (btns[1] as HTMLButtonElement).click();
    expect(active).toBe('aparente');
    expect(btns[1].getAttribute('aria-pressed')).toBe('true');
    expect(btns[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('refresh hides the container when isVisible returns false', () => {
    const wrap = mkWrap();
    let visible = true;
    const group = createSubOptionsGroup<V>(wrap, {
      containerId: 'g3',
      getActive: () => 'actual',
      onSelect: () => undefined,
      isVisible: () => visible,
      options: [{ id: 'actual', label: 'Actual' }],
    });
    const cont = wrap.querySelector('#g3') as HTMLElement;
    expect(cont).not.toBeNull();
    expect(cont.classList.contains('flex')).toBe(true);
    visible = false;
    group.refresh();
    expect(cont.classList.contains('hidden')).toBe(true);
  });

  it('null wrap returns a no-op refresh', () => {
    const group = createSubOptionsGroup<V>(null, {
      containerId: 'g',
      getActive: () => 'actual',
      onSelect: () => undefined,
      isVisible: () => true,
      options: [{ id: 'actual', label: 'Actual' }],
    });
    expect(() => group.refresh()).not.toThrow();
  });
});
