const vscode = require('vscode');

const COMMANDS = [
    'write', 'copy', 'label', 'jump', 'jump_if', 'jump_if_not',
    'jump_err', 'cpu_exec', 'var', 'DEBUG_ON', 'DEBUG_OFF'
];

const REGISTERS = [
    'REG_OP', 'REG_A', 'REG_B', 'REG_C', 'REG_D', 'REG_E', 'REG_F',
    'REG_RES', 'REG_BOOL_RES', 'REG_ERROR', 'REG_LAST_KEY',
    'REG_USER_SPACE_REGS_END', 'SYS_ENERGY',
    'DISPLAY_BUFFER', 'DISPLAY_COLOR', 'DISPLAY_BACKGROUND',
    'KEYBOARD_BUFFER', 'PROGRAM_COUNTER',
    'FREE_MEMORY_START', 'FREE_MEMORY_END', 'FREE_CHUNKS',
    'REG_PROC_START_ADDRESS', 'REG_PROC_END_ADDRESS',
    'REG_SYS_CALL_HANDLER', 'REG_SYS_RET_ADDRESS',
    'REG_SYS_INTERRUPT_HANDLER', 'REG_SYS_INTERRUPT_DATA',
    'REG_SYS_HW_TIMER', 'KERNEL_START'
];

const OPERATIONS = [
    'OP_ADD', 'OP_SUB', 'OP_INCR', 'OP_DECR', 'OP_DIV', 'OP_MOD', 'OP_MUL',
    'OP_IS_NUM', 'OP_CMP_EQ', 'OP_CMP_NEQ', 'OP_CMP_LT', 'OP_CMP_LE',
    'OP_CONTAINS', 'OP_GET_LENGTH', 'OP_STARTS_WITH', 'OP_GET_COLUMN',
    'OP_REPLACE_COLUMN', 'OP_CONCAT_WITH',
    'OP_READ_INPUT', 'OP_DISPLAY', 'OP_DISPLAY_LN',
    'OP_READ_BLOCK', 'OP_WRITE_BLOCK',
    'OP_SET_BACKGROUND_COLOR', 'OP_RENDER_BITMAP',
    'OP_SYS_CALL', 'OP_SYS_RETURN',
    'OP_ENCRYPT_DATA', 'OP_DECRYPT_DATA',
    'OP_NOP', 'OP_HALT', 'OP_UNKNOWN'
];

const SYSCALLS = [
    'SYS_CALL_EXIT', 'SYS_CALL_PRINTLN', 'SYS_CALL_PRINT',
    'SYS_CALL_READ_INPUT', 'SYS_CALL_OPEN', 'SYS_CALL_DESCRIPTOR_INFO',
    'SYS_CALL_CLOSE', 'SYS_CALL_READ', 'SYS_CALL_WRITE',
    'SYS_CALL_SET_BACKGROUND', 'SYS_CALL_RENDER_BITMAP',
    'SYS_CALL_SLEEP', 'SYS_CALL_GET_FILE_ATTR', 'SYS_CALL_SET_FILE_ATTR',
    'SYS_CALL_SCHED_PROGRAM', 'SYS_CALL_IS_PROCESS_ACTIVE',
    'SYS_CALL_KILL_PROCESS', 'SYS_CALL_SKIP_SCHED', 'SYS_CALL_WAIT_SCHED'
];

const COLORS = [
    'COLOR_NO', 'COLOR_GREEN', 'COLOR_YELLOW', 'COLOR_RED',
    'COLOR_BLACK', 'COLOR_BLUE', 'COLOR_MAGENTA', 'COLOR_CYAN', 'COLOR_WHITE', 'COLOR_PINK'
];

const KEYBOARD_MODES = [
    'KEYBOARD_READ_LINE', 'KEYBOARD_READ_LINE_SILENTLY',
    'KEYBOARD_READ_CHAR', 'KEYBOARD_READ_CHAR_SILENTLY'
];

function tokenize(text) {
    const tokens = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            inQuotes = !inQuotes;
            current += c;
        } else if (/\s/.test(c) && !inQuotes) {
            if (current) {
                tokens.push(current);
                current = '';
            }
        } else {
            current += c;
        }
    }
    if (current) tokens.push(current);

    return tokens;
}

function snippet(label, insertText, detail) {
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Snippet);
    item.insertText = new vscode.SnippetString(insertText);
    item.detail = detail;
    return item;
}

function constantItem(name, detail) {
    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Constant);
    if (detail) item.detail = detail;
    return item;
}

function addressCompletions() {
    return [
        ...REGISTERS.map(r => constantItem(r, 'Register')),
        ...REGISTERS.map(r => constantItem('*' + r, 'Dereferenced register')),
        snippet('var:', 'var:${1:name}', 'Variable reference'),
        snippet('*var:', '*var:${1:name}', 'Dereferenced variable'),
    ];
}

function activate(context) {
    const provider = vscode.languages.registerCompletionItemProvider(
        'kaguasm',
        {
            provideCompletionItems(document, position) {
                const lineText = document.lineAt(position).text;
                const linePrefix = lineText.substring(0, position.character);

                // No completions inside comments
                if (linePrefix.trimStart().startsWith('//')) return [];

                // No completions inside quoted strings
                const quoteCount = (linePrefix.match(/"/g) || []).length;
                if (quoteCount % 2 === 1) return [];

                const tokens = tokenize(linePrefix);
                const endsWithSpace = linePrefix.length > 0 && /\s/.test(linePrefix[linePrefix.length - 1]);
                const currentPosition = endsWithSpace ? tokens.length + 1 : tokens.length;

                // Position 1: suggest commands
                if (currentPosition <= 1) {
                    return COMMANDS.map(cmd => {
                        const item = new vscode.CompletionItem(cmd, vscode.CompletionItemKind.Keyword);
                        item.detail = 'Command';
                        return item;
                    });
                }

                const command = tokens[0];

                if (command === 'write') {
                    if (currentPosition === 2) {
                        // Write value: literals and constants only
                        return [
                            ...OPERATIONS.map(op => constantItem(op, 'Operation')),
                            ...SYSCALLS.map(sc => constantItem(sc, 'System call')),
                            ...COLORS.map(c => constantItem(c, 'Color')),
                            ...KEYBOARD_MODES.map(m => constantItem(m, 'Keyboard mode')),
                            snippet('label:', 'label:${1:name}', 'Label reference'),
                        ];
                    }
                    if (currentPosition === 3) {
                        return [new vscode.CompletionItem('to', vscode.CompletionItemKind.Keyword)];
                    }
                    if (currentPosition === 4) {
                        return addressCompletions();
                    }
                }

                if (command === 'copy') {
                    if (currentPosition === 2) {
                        return [
                            ...addressCompletions(),
                            snippet('@var:', '@var:${1:name}', 'Variable literal value'),
                        ];
                    }
                    if (currentPosition === 3) {
                        return [new vscode.CompletionItem('to', vscode.CompletionItemKind.Keyword)];
                    }
                    if (currentPosition === 4) {
                        return addressCompletions();
                    }
                }

                if (['jump', 'jump_if', 'jump_if_not', 'jump_err'].includes(command)) {
                    if (currentPosition === 2) {
                        return [
                            snippet('label:', 'label:${1:name}', 'Label reference'),
                            snippet('*label:', '*label:${1:name}', 'Dereferenced label'),
                            snippet('*var:', '*var:${1:name}', 'Dereferenced variable'),
                            ...REGISTERS.map(r => constantItem('*' + r, 'Dereferenced register')),
                        ];
                    }
                }

                return [];
            }
        },
        ' '
    );

    context.subscriptions.push(provider);
}

function deactivate() {}

module.exports = { activate, deactivate };
