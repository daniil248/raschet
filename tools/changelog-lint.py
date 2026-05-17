#!/usr/bin/env python3
# =========================================================================
# tools/changelog-lint.py - страж синтаксиса shared/module-changelogs.js.
# Zero-deps (stdlib). Ловит класс site-wide поломок, который НЕ видел
# прежний newline-in-str скан: сырой ASCII-апостроф внутри одиночно-
# кавыченной строки записи changelog рано закрывает строку → дальше
# голый идентификатор → SyntaxError при парсинге файла → падает
# динамический import в shared/module-footer.js → красная плашка на
# ВСЕХ страницах (маскируется edge-кэшем GitHub Pages; см. инцидент
# v0.60.599→v0.60.639, memory feedback_changelog_escaping).
#
#   python3 tools/changelog-lint.py            # exit 1 при нарушении
#
# Проверки (JS-string токенайзер, не regex):
#   1. Запрещённая последовательность \\'  (двойной бэкслеш+апостроф).
#   2. Перенос строки внутри '...' / "..." (newline-in-string).
#   3. «Строка закрылась → сразу идентификатор» — индикатор раннего
#      закрытия строки сырым апострофом (это и был баг 'module').
#   4. Файл должен завершаться в code-состоянии (нет открытой строки).
#
# Рекомендуется как CI-шаг (blocking) + ручной прогон перед каждым
# коммитом, меняющим module-changelogs.js (правило feedback_
# changelog_escaping становится механически проверяемым).
# =========================================================================
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TARGET = os.path.join(ROOT, 'shared', 'module-changelogs.js')

BS = chr(92)   # backslash
SQ = chr(39)   # '
DQ = chr(34)   # "
BT = chr(96)   # `
NL = chr(10)   # newline


def lint(path):
    src = open(path, encoding='utf-8').read()
    errs = []

    # 1. forbidden \\' (двойной бэкслеш + апостроф) — латентная поломка.
    bad_bsapos = src.count(BS + BS + SQ)
    if bad_bsapos:
        errs.append('forbidden sequence %s%s%s встречается %d раз '
                    '(использовать %s%s или избегать апострофа)'
                    % (BS, BS, SQ, bad_bsapos, BS, SQ))

    # 2/3/4: JS-string токенайзер.
    i = 0
    n = len(src)
    line = 1
    st = None        # None | SQ | DQ | BT
    esc = False
    nl_in_str = 0
    nl_first = None
    early_close = []
    while i < n:
        ch = src[i]
        if ch == NL:
            line += 1
        if st is None:
            if ch in (SQ, DQ, BT):
                st = ch
            elif ch == '/' and i + 1 < n and src[i + 1] == '/':
                while i < n and src[i] != NL:
                    i += 1
                continue
            elif ch == '/' and i + 1 < n and src[i + 1] == '*':
                i += 2
                while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                    if src[i] == NL:
                        line += 1
                    i += 1
                i += 2
                continue
        else:
            if esc:
                esc = False
            elif ch == BS:
                esc = True
            elif ch == st:
                # строка закрылась — заглянуть на следующий значимый символ
                j = i + 1
                while j < n and src[j] in ' \t':
                    j += 1
                nxt = src[j] if j < n else ''
                if nxt and (nxt.isalpha() or nxt == '_') and st in (SQ, DQ):
                    early_close.append(line)
                st = None
            elif ch == NL and st in (SQ, DQ):
                nl_in_str += 1
                if nl_first is None:
                    nl_first = line
        i += 1

    if nl_in_str:
        errs.append('newline-in-string: %d (первый на строке %s) — строка '
                    'записи разорвана переносом' % (nl_in_str, nl_first))
    if early_close:
        errs.append('string-closed-then-identifier: %d (строки: %s) — '
                    'индикатор раннего закрытия строки сырым апострофом '
                    '(класс бага «Unexpected identifier»)'
                    % (len(early_close), ', '.join(map(str, early_close[:10]))))
    if st is not None:
        errs.append('файл завершился с НЕЗАКРЫТОЙ строкой (st=%r)' % st)

    return errs


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else TARGET
    if not os.path.exists(path):
        print('[changelog-lint] нет файла: %s' % path)
        sys.exit(2)
    errs = lint(path)
    rel = os.path.relpath(path, ROOT).replace(os.sep, '/')
    if errs:
        print('[changelog-lint] FAIL %s:' % rel)
        for e in errs:
            print('  - ' + e)
        print('Правило: memory feedback_changelog_escaping. '
              'Апостроф в тексте записи = «ёлочки» или конкатенация '
              "'..'+chr(39)+'..'; НИКОГДА сырой ' + SQ + ' и НИКОГДА "
              + BS + BS + SQ + '.')
        sys.exit(1)
    print('[changelog-lint] OK %s — синтаксис строк чист '
          '(0 %s%s%s, 0 newline-in-str, 0 early-close, final code).'
          % (rel, BS, BS, SQ))
    sys.exit(0)


if __name__ == '__main__':
    main()
