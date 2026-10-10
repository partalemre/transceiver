"""Two people, live: a DM and a project room between two sessions with their own stores, driven as the Code tab
drives the pane (MODZ tools/desk). Each step prints how long it took; exit 1 on the first that does not happen.

Both sessions are this machine's account, so this proves the pane, the relay and the agent gate, not sharing
across accounts. It publishes four private mailboxes to that account and costs one small model turn.
Usage: python3 -I bin/e2e.py [run-name]   (MODZ_DESK points at MODZ's tools/desk; REPO_DIR at a GitHub clone)
The pane speaks English unless MODZ_LANG=tr is exported (the sessions inherit it); the steps wait for its words.
"""
import os
import re
import shutil
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.environ.get('MODZ_DESK', os.path.expanduser('~/Projects/MODZ/tools/desk')))
from desk import Desk, Engine, walk  # noqa: E402

PANE = 'transceiver'
REPO_DIR = os.environ.get('REPO_DIR', os.path.expanduser('~/Projects/MODZ'))
REPO = os.environ.get('REPO', 'partalemre/MODZ')
STEP_S = 90
URL = re.compile(r'https://claude\.ai/artifact/\w+')
# The words each step waits for, in the pane's language (hooks/kit/lang.ts: a value starting with "tr" is Turkish).
WORDS = {
    'en': {'ready': 'Your mailbox is ready', 'unseen': "hasn't read", 'gh': ' on GitHub?'},
    'tr': {'ready': 'Kutun hazır', 'unseen': 'henüz okumadı', 'gh': "GitHub'da @"},
}
SAYS = WORDS['tr' if os.environ.get('MODZ_LANG', '').strip().lower().startswith('tr') else 'en']
# An answer the other side refused; the wire keeps this wording in every language (hooks/protocol.ts DENIED).
DENIED = 'erişim yok'


class Person:
    def __init__(self, name, work):
        plugin = os.path.join(work, name, 'transceiver')
        shutil.copytree(ROOT, plugin, symlinks=True, ignore=shutil.ignore_patterns('.git', 'node_modules', '.claude'))
        args = ['--plugin-dir', plugin, '--permission-mode', 'bypassPermissions', '--model', 'haiku']
        self.engine = Engine(REPO_DIR, args, home=os.path.join(work, name, 'config'))
        self.desk = Desk(self.engine)
        self.engine.say('/transceiver')

    def keys(self, kind='Button'):
        return [k for k, _ in walk(self.desk.tree, kind)]

    def wait(self, step, pred):
        start = time.time()
        while time.time() - start < STEP_S:
            self.desk.render(PANE)
            if pred(self.desk.text()):
                print(f'✔ {step} ({time.time() - start:.1f}s)')
                return self.desk.text()
            time.sleep(0.25)
        sys.exit(f'✘ {step}: {self.desk.text()[:400]}')

    def press(self, key):
        self.desk.render(PANE)
        self.desk.press(key)

    def type(self, key, text):
        self.desk.render(PANE)
        if not any(k == key or k.startswith(key) for k in self.keys('Input')):
            sys.exit(f'✘ no field {key}: {self.keys("Input")}')
        self.desk.type(next(k for k in self.keys('Input') if k == key or k.startswith(key)), text, PANE)


def pair(a, b, open_room):
    """A opens a room, B joins by A's link, A adds B's link: the two link swaps a person makes by hand."""
    open_room()
    url_a = URL.findall(a.wait('A: own mailbox ready', lambda s: SAYS['ready'] in s))[0]
    a.press('created-ok')
    b.desk.render(PANE)
    b.press('open-join' if 'open-join' in b.keys() else 'open-add')
    b.type('join-link', url_a)
    url_b = [u for u in URL.findall(b.wait('B: joined, asked to share back', lambda s: SAYS['unseen'] in s)) if u != url_a][0]
    a.press('open-add')
    a.type('join-link', url_b)
    a.wait('A: B added', lambda s: 'composer' in ' '.join(a.keys('Input')))


def chat(a, b):
    a.type('composer', 'merhaba, burası A')
    b.wait('B: got A\'s message', lambda s: 'merhaba, burası A' in s)
    b.type('composer', 'selam, B burada')
    a.wait('A: got B\'s reply and a read receipt', lambda s: 'selam, B burada' in s and '✓✓' in s)


def ask(a, b):
    for person, who in ((a, 'A'), (b, 'B')):
        person.wait(f'{who}: GitHub match card in the chat', lambda s: SAYS['gh'] in s)
        person.press('gh-yes')
    seen = len(a.engine.msgs)
    a.engine.say('Call the mcp__transceiver__ask tool with {"type":"status"} once, then reply with the exact tool result text only.')
    start = time.time()
    while time.time() - start < STEP_S:
        result = next((m.get('result') for m in a.engine.msgs[seen:] if m.get('type') == 'result'), None)
        if result is not None:
            ok = '·' in result and DENIED not in result
            print(f'{"✔" if ok else "✘"} A\'s agent asked B\'s side for status ({time.time() - start:.1f}s): {result[:120]}')
            return ok
        time.sleep(0.5)
    sys.exit('✘ the agent ask never finished')


def main():
    work = tempfile.mkdtemp(prefix=f'tx-e2e-{sys.argv[1] if len(sys.argv) > 1 else "run"}-')
    a, b = Person('a', work), Person('b', work)
    time.sleep(6)
    print('— DM')
    pair(a, b, lambda: a.press('add-dm'))
    chat(a, b)
    a.press('back')
    b.press('back')
    print('— project room', REPO)
    a.press('open-add')
    pair(a, b, lambda: a.type('add-repo', REPO))
    ok = ask(a, b)
    a.engine.close()
    b.engine.close()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
