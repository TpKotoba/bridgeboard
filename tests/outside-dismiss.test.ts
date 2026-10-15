import test from 'node:test';
import assert from 'node:assert/strict';
import { listenForOutsideDismiss } from '../lib/outside-dismiss';

function fixture() {
  class TestNode {}
  const inside = new TestNode();
  const outside = new TestNode();
  const document = Object.assign(new EventTarget(), { defaultView: { Node: TestNode } });
  const root = { ownerDocument: document, contains: (node: unknown) => node === inside };
  let dismissed = 0;
  const cleanup = listenForOutsideDismiss(root as unknown as HTMLElement, () => dismissed++);
  const dispatch = (type: string, target: TestNode, relatedTarget: TestNode | null = null) => {
    const event = new Event(type);
    Object.defineProperties(event, { target: { value: target }, relatedTarget: { value: relatedTarget } });
    document.dispatchEvent(event);
  };
  return { inside, outside, dispatch, cleanup, get dismissed() { return dismissed; } };
}

test('Safari-style internal tap followed by blur with no new focus keeps the action mounted through click', () => {
  const f = fixture();
  f.dispatch('pointerdown', f.inside);
  f.dispatch('blur', f.inside);
  f.dispatch('focusout', f.inside);
  assert.equal(f.dismissed, 0);
  f.dispatch('click', f.inside);
  assert.equal(f.dismissed, 0);
  f.cleanup();
});

test('keyboard movement inside stays open; actual outside focus or touch dismisses', () => {
  const f = fixture();
  f.dispatch('focusin', f.inside);
  assert.equal(f.dismissed, 0);
  f.dispatch('focusin', f.outside);
  assert.equal(f.dismissed, 1);
  f.dispatch('pointerdown', f.outside);
  assert.equal(f.dismissed, 2);
  f.cleanup();
  f.dispatch('pointerdown', f.outside);
  f.dispatch('focusin', f.outside);
  assert.equal(f.dismissed, 2);
});
