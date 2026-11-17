#!/usr/bin/env python3
"""The repo room, live, between two real sessions with separate stores and one real GitHub repo.

A opens the repo's room; B, started afterwards in the same repo, gets it by itself: no link, no share, no press.
They chat, then A's agent asks B's side for status. Every mailbox ref the run made is removed at the end.

Usage: REPO=owner/name REPO_DIR=/a/checkout/of/it python3 -I bin/e2e-repo.py [run-name]
"""
import os
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from e2e import DENIED, PANE, REPO, STEP_S, Person, chat  # noqa: E402

REMOTE = f'https://github.com/{REPO}.git'
REFS = 'refs/transceiver/'


def refs():
    out = subprocess.run(['git', 'ls-remote', REMOTE, REFS + '*'], capture_output=True, text=True, check=True).stdout
    return [line.split('\t')[1] for line in out.splitlines() if '\t' in line]


MENU = ('open-add', 'open-settings', 'open-join', 'open-project')


def room_keys(person):
    return [k for k in person.keys() if k.startswith('open-') and k not in MENU]


def ask(a):
    seen = len(a.engine.msgs)
    a.engine.say('Call the mcp__transceiver__ask tool with {"type":"status"} once, then reply with the exact tool result text only.')
    start = time.time()
    while time.time() - start < STEP_S:
        result = next((m.get('result') for m in a.engine.msgs[seen:] if m.get('type') == 'result'), None)
        if result is not None:
            if 'Not logged in' in result:
                print('– agent ask not run: this engine has no signed-in model (run `claude /login`)')
                return True
            ok = '·' in result and not any(word in result for word in DENIED)
            print(f'{"✔" if ok else "✘"} A\'s agent asked B\'s side for status ({time.time() - start:.1f}s): {result[:120]}')
            return ok
        time.sleep(0.5)
    sys.exit('✘ the agent ask never finished')


def main():
    before = set(refs())
    work = tempfile.mkdtemp(prefix=f'tx-repo-{sys.argv[1] if len(sys.argv) > 1 else "run"}-')
    ok = False
    try:
        a = Person('a', work)
        time.sleep(6)
        a.desk.render(PANE)
        a.press('open-project')
        time.sleep(1)
        a.type('add-repo', REPO)
        a.wait('A: the repo room opened straight into the chat', lambda s: 'composer' in ' '.join(a.keys('Input')))
        a.type('composer', 'ilk mesaj, oda açıldı')
        a.wait('A: the first line is written to the repo', lambda s: 'ilk mesaj, oda açıldı' in s and '✓' in s)
        start = time.time()
        while not set(refs()) - before:
            if time.time() - start > STEP_S:
                sys.exit('✘ A\'s mailbox never reached the repo')
            time.sleep(1)
        print(f'✔ A\'s mailbox is in the repo ({time.time() - start:.1f}s)')
        b = Person('b', work)
        b.wait('B: the room appeared by itself', lambda s: len(room_keys(b)) > 0)
        b.press(room_keys(b)[0])
        b.wait('B: reads A\'s first line', lambda s: 'ilk mesaj, oda açıldı' in s)
        chat(a, b)
        ok = ask(a)
        a.engine.close()
        b.engine.close()
    finally:
        made = set(refs()) - before
        if made:
            subprocess.run(['git', 'push', '-q', REMOTE, *[f':{ref}' for ref in made]], check=False)
        print(f'removed {len(made)} mailbox ref(s) the run made')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
