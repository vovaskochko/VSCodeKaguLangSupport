const vscode = require('vscode');
const net    = require('net');
const path   = require('path');
const fs     = require('fs');
const { spawn } = require('child_process');

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

// ============================================================================
// Register name map (from registers.hpp) and reverse lookup
// ============================================================================
const REG_NAMES = {
     1: 'REG_A',              2: 'REG_B',              3: 'REG_C',
     4: 'REG_D',              5: 'REG_E',              6: 'REG_F',
     7: 'REG_OP',             8: 'REG_RES',            9: 'REG_BOOL_RES',
    10: 'REG_ERROR',         11: 'REG_LAST_KEY',
    12: 'DISPLAY_BUFFER',    13: 'DISPLAY_COLOR',     14: 'KEYBOARD_BUFFER',
    15: 'DISPLAY_BACKGROUND',16: 'PROGRAM_COUNTER',   17: 'SYS_ENERGY',
    18: 'FREE_MEMORY_END',   19: 'FREE_MEMORY_START', 20: 'FREE_CHUNKS',
    21: 'PROC_START_ADDRESS',22: 'PROC_END_ADDRESS',  23: 'SYS_CALL_HANDLER',
    24: 'SYS_RET_ADDRESS',   25: 'SYS_INTERRUPT_HANDLER',
    26: 'SYS_INTERRUPT_DATA',27: 'SYS_HW_TIMER',
};

// Reverse map: name -> address (for setVariable)
const ADDR_BY_NAME = Object.fromEntries(
    Object.entries(REG_NAMES).map(([addr, name]) => [name, parseInt(addr)]));

// Value interpretation tables (addr -> { numericValue -> constantName })
const OP_NAMES = {
     0: 'OP_ADD',                1: 'OP_SUB',            2: 'OP_INCR',
     3: 'OP_DECR',               4: 'OP_DIV',            5: 'OP_MOD',
     6: 'OP_MUL',                7: 'OP_IS_NUM',
     8: 'OP_CMP_EQ',             9: 'OP_CMP_NEQ',       10: 'OP_CMP_LT',
    11: 'OP_CMP_LE',
    12: 'OP_CONTAINS',          13: 'OP_GET_LENGTH',    14: 'OP_STARTS_WITH',
    15: 'OP_GET_COLUMN',        16: 'OP_REPLACE_COLUMN',17: 'OP_CONCAT_WITH',
    18: 'OP_READ_INPUT',        19: 'OP_DISPLAY',       20: 'OP_DISPLAY_LN',
    21: 'OP_READ_BLOCK',        22: 'OP_WRITE_BLOCK',
    23: 'OP_SET_BACKGROUND_COLOR', 24: 'OP_RENDER_BITMAP',
    25: 'OP_SYS_CALL',          26: 'OP_SYS_RETURN',
    27: 'OP_ENCRYPT_DATA',      28: 'OP_DECRYPT_DATA',
    29: 'OP_NOP',               30: 'OP_HALT',          31: 'OP_UNKNOWN',
};

const COLOR_NAMES = {
    0: 'COLOR_NO',   1: 'COLOR_GREEN',   2: 'COLOR_YELLOW', 3: 'COLOR_RED',
    4: 'COLOR_BLACK',5: 'COLOR_BLUE',    6: 'COLOR_MAGENTA',7: 'COLOR_CYAN',
    8: 'COLOR_WHITE',9: 'COLOR_PINK',
};

// Which addresses have a value interpretation table
const VALUE_INTERPRETERS = {
     7: OP_NAMES,      // REG_OP
    13: COLOR_NAMES,   // DISPLAY_COLOR
    15: COLOR_NAMES,   // DISPLAY_BACKGROUND
};

function interpretValue(addr, raw) {
    if (!raw) return '""';
    const table = VALUE_INTERPRETERS[addr];
    if (!table) return raw;
    const n = parseInt(raw);
    if (!isNaN(n) && table[n] !== undefined) return `${raw} (${table[n]})`;
    return raw;
}


// ============================================================================
// KaguDebugAdapter — inline DAP implementation
// ============================================================================
class KaguDebugAdapter {
    constructor() {
        this._emitter = new vscode.EventEmitter();
        this.onDidSendMessage = this._emitter.event;

        this._seq = 1;
        this._proc = null;
        this._socket = null;
        this._recvBuf = '';
        this._addrToSrc = new Map();   // addr -> { file, line }
        this._srcToAddr = new Map();   // 'file:line' -> addr
        this._bpByFile  = new Map();   // srcPath -> Set<addr>
        this._currentPc = null;
        this._ramSize = null;          // received from READY handshake
        this._launchReq = null;        // deferred until READY arrives
        this._stateCallback = null;    // set while waiting for STATE response
        this._pendingCmds  = [];       // queued before socket connects
        this._isPaused = false;        // true when CPU is at a breakpoint / halted

        // Terminal (PTY)
        this._writeEmitter = new vscode.EventEmitter();
        this._terminal = null;
        this._inputBuffer = '';
    }

    // ---- DAP transport --------------------------------------------------

    _send(msg) {
        msg.seq = this._seq++;
        this._emitter.fire(msg);
    }

    _respond(req, body) {
        this._send({ type: 'response', request_seq: req.seq,
                     success: true, command: req.command, body: body || {} });
    }

    _event(event, body) {
        this._send({ type: 'event', event, body: body || {} });
    }

    // ---- kagu_boot TCP --------------------------------------------------

    _toKagu(line) {
        if (this._socket && !this._socket.destroyed) {
            this._socket.write(line + '\n');
        } else {
            this._pendingCmds.push(line);
        }
    }

    _flushPending() {
        for (const cmd of this._pendingCmds) {
            this._socket.write(cmd + '\n');
        }
        this._pendingCmds = [];
    }

    _onSocketData(data) {
        this._recvBuf += data.toString();
        const lines = this._recvBuf.split('\n');
        this._recvBuf = lines.pop();   // incomplete tail

        for (const raw of lines) {
            const line = raw.trimEnd();
            if (!line) continue;

            if (line.startsWith('READY ')) {
                this._ramSize = parseInt(line.split(' ')[1]);
                if (this._launchReq) {
                    this._respond(this._launchReq);
                    this._launchReq = null;
                }
            } else if (this._stateCallback && (line.startsWith('RAM ') || line === 'END')) {
                this._stateCallback(line);
                if (line === 'END') this._stateCallback = null;
            } else if (line.startsWith('PAUSED ')) {
                this._currentPc = parseInt(line.split(' ')[1]);
                this._isPaused = true;
                this._event('stopped', { reason: 'breakpoint',
                    threadId: 1, allThreadsStopped: true });
            } else if (line === 'HALTED') {
                this._isPaused = true;
                this._event('stopped', { reason: 'pause',
                    description: 'CPU halted', threadId: 1, allThreadsStopped: true });
            }
        }
    }

    // ---- Source map -----------------------------------------------------

    _loadMap(mapFile) {
        try {
            const lines = fs.readFileSync(mapFile, 'utf8').split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                if (trimmed.startsWith('var:')) {
                    // var:name addr file:line
                    const parts = trimmed.split(' ');
                    if (parts.length < 2) continue;
                    const varName = parts[0];           // "var:name"
                    const addr    = parseInt(parts[1]);
                    if (isNaN(addr)) continue;
                    this._srcToAddr.set(varName, addr); // "var:name" -> addr
                    if (parts.length >= 3) {
                        const rest   = parts[2];
                        const colon  = rest.lastIndexOf(':');
                        if (colon >= 0) {
                            const file = rest.substring(0, colon);
                            const ln   = parseInt(rest.substring(colon + 1));
                            this._addrToSrc.set(addr, { file, line: ln });
                        }
                    }
                    continue;
                }

                // addr file:line  (instruction entry)
                const sp = trimmed.indexOf(' ');
                if (sp < 0) continue;
                const addr  = parseInt(trimmed.substring(0, sp));
                const rest  = trimmed.substring(sp + 1).trim();
                const colon = rest.lastIndexOf(':');
                if (colon < 0) continue;
                const file  = rest.substring(0, colon);
                const ln    = parseInt(rest.substring(colon + 1));
                this._addrToSrc.set(addr, { file, line: ln });
                this._srcToAddr.set(`${file}:${ln}`, addr);
                const base = path.basename(file);
                if (!this._srcToAddr.has(`${base}:${ln}`))
                    this._srcToAddr.set(`${base}:${ln}`, addr);
            }
        } catch (_) {}
    }

    _resolveAddr(srcPath, line) {
        return this._srcToAddr.get(`${srcPath}:${line}`)
            ?? this._srcToAddr.get(`${path.basename(srcPath)}:${line}`);
    }

    // ---- DAP handlers ---------------------------------------------------

    handleMessage(message) {
        const h = {
            initialize:          () => this._handleInitialize(message),
            launch:              () => this._handleLaunch(message),
            setBreakpoints:      () => this._handleSetBreakpoints(message),
            configurationDone:   () => this._handleConfigDone(message),
            continue:            () => this._handleContinue(message),
            next:                () => this._handleNext(message),
            stepIn:              () => this._handleNext(message),
            stackTrace:          () => this._handleStackTrace(message),
            scopes:              () => this._handleScopes(message),
            variables:           () => this._handleVariables(message),
            setVariable:         () => this._handleSetVariable(message),
            evaluate:            () => this._handleEvaluate(message),
            threads:             () => this._respond(message, { threads: [{ id: 1, name: 'KaguOS CPU' }] }),
            disconnect:          () => this._handleDisconnect(message),
        };
        (h[message.command] ?? (() => this._respond(message)))();
    }

    _handleInitialize(req) {
        this._respond(req, {
            supportsConfigurationDoneRequest: true,
            supportsSetVariable: true,
            supportsEvaluateForHovers: true,
        });
        this._event('initialized');
    }

    _handleLaunch(req) {
        const a = req.arguments || {};
        const root      = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? process.cwd();
        const abs       = p => path.isAbsolute(p) ? p : path.join(root, p);
        const firmware  = a.firmware  ?? 'hw/cpu_firmware.bin';
        const ramSize   = String(a.ramSize ?? 2048);
        const mapFile   = abs(a.mapFile  ?? 'build/kernel.map');
        const kaguBoot  = abs(a.kaguBoot ?? './kagu_boot');
        const debugPort = a.debugPort ?? 4711;

        this._loadMap(mapFile);
        this._launchReq = req;  // respond only after READY is received

        // Create the interactive terminal (PTY) before spawning the process
        const writeEmitter = this._writeEmitter;
        const self = this;
        const pty = {
            onDidWrite: writeEmitter.event,
            open() {},
            close() { self._proc?.kill(); },
            handleInput(data) {
                for (const ch of data) {
                    if (ch === '\r') {
                        // Enter — send buffered line to kagu_boot stdin
                        writeEmitter.fire('\r\n');
                        self._proc?.stdin?.write(self._inputBuffer + '\n');
                        self._inputBuffer = '';
                    } else if (ch === '\x7f' || ch === '\x08') {
                        // Backspace
                        if (self._inputBuffer.length > 0) {
                            self._inputBuffer = self._inputBuffer.slice(0, -1);
                            writeEmitter.fire('\x1b[D \x1b[D');
                        }
                    } else if (ch >= ' ') {
                        self._inputBuffer += ch;
                        writeEmitter.fire(ch);
                    }
                }
            }
        };
        this._terminal = vscode.window.createTerminal({ name: 'KaguOS', pty });
        this._terminal.show();

        this._proc = spawn(kaguBoot, [firmware, ramSize, '--debug-port', String(debugPort)],
                           { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });

        // Wire proc stdout/stderr to the terminal
        this._proc.stdout.on('data', d => {
            writeEmitter.fire(d.toString().replace(/\n/g, '\r\n'));
        });
        this._proc.stderr.on('data', d => {
            this._event('output', { category: 'stderr', output: d.toString() });
        });

        // Give kagu_boot a moment to bind the socket before we connect
        setTimeout(() => {
            this._socket = net.createConnection(debugPort, '127.0.0.1', () => {
                this._flushPending();
                // launch response is sent when READY arrives, not here
            });
            this._socket.on('data', d => this._onSocketData(d));
            this._socket.on('close', () => this._event('terminated'));
            this._socket.on('error', err => {
                this._event('output', { category: 'stderr',
                    output: `[kagu] socket error: ${err.message}\n` });
                this._event('terminated');
            });
        }, 400);
    }

    _handleSetBreakpoints(req) {
        const args    = req.arguments || {};
        const srcPath = args.source?.path ?? '';
        const wanted  = args.breakpoints ?? [];

        // Clear previously registered breakpoints for this file
        for (const addr of (this._bpByFile.get(srcPath) ?? new Set()))
            this._toKagu(`CLEAR ${addr}`);

        const newAddrs = new Set();
        const result   = [];
        for (const bp of wanted) {
            const addr = this._resolveAddr(srcPath, bp.line);
            if (addr !== undefined) {
                this._toKagu(`BREAK ${addr}`);
                newAddrs.add(addr);
                result.push({ verified: true, line: bp.line });
            } else {
                result.push({ verified: false, message: `No instruction at line ${bp.line}` });
            }
        }
        this._bpByFile.set(srcPath, newAddrs);
        this._respond(req, { breakpoints: result });
    }

    _handleConfigDone(req) {
        this._respond(req);
        this._toKagu('CONTINUE');
    }

    _handleContinue(req) {
        this._isPaused = false;
        this._respond(req, { allThreadsContinued: true });
        this._event('continued', { threadId: 1, allThreadsContinued: true });
        this._toKagu('CONTINUE');
    }

    _handleNext(req) {
        this._isPaused = false;
        this._respond(req);
        this._toKagu('STEP');
    }

    _handleStackTrace(req) {
        const frames = [];
        if (this._currentPc !== null) {
            const src = this._addrToSrc.get(this._currentPc);
            if (src) {
                const absFile = path.isAbsolute(src.file) ? src.file
                    : path.join(vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath ?? '', src.file);
                frames.push({ id: 1, name: `PC=${this._currentPc}`,
                    source: { name: path.basename(src.file), path: absFile },
                    line: src.line, column: 1 });
            } else {
                frames.push({ id: 1, name: `PC=${this._currentPc} (no source)`,
                    line: 0, column: 0 });
            }
        }
        this._respond(req, { stackFrames: frames, totalFrames: frames.length });
    }

    _handleScopes(req) {
        this._respond(req, { scopes: [
            { name: 'RAM', variablesReference: 1, expensive: true },
        ]});
    }

    _handleVariables(req) {
        const end = this._ramSize ?? 2048;

        const variables = [];
        this._stateCallback = line => {
            if (line.startsWith('RAM ')) {
                const parts = line.split(' ');
                const addr  = parseInt(parts[1]);
                const value = parts.slice(2).join(' ');
                const name  = REG_NAMES[addr] ?? `[${addr}]`;
                variables.push({ name, value: interpretValue(addr, value),
                                  variablesReference: 0 });
            } else if (line === 'END') {
                this._respond(req, { variables });
            }
        };
        this._toKagu(`STATE 1 ${end}`);
    }

    _handleSetVariable(req) {
        const args  = req.arguments || {};
        const name  = args.name  ?? '';
        const value = args.value ?? '';

        // Resolve name → RAM address
        let addr = ADDR_BY_NAME[name]
            ?? this._srcToAddr.get(name)
            ?? this._srcToAddr.get('var:' + name);
        if (addr === undefined) {
            const m = name.match(/^\[(\d+)\]$/);
            if (m) addr = parseInt(m[1]);
        }

        if (addr !== undefined) {
            this._toKagu(`SET ${addr} ${value}`);
            this._respond(req, { value, type: 'string' });
        } else {
            this._send({ type: 'response', request_seq: req.seq,
                         success: false, command: req.command,
                         message: `Unknown variable: ${name}` });
        }
    }

    _handleEvaluate(req) {
        const expr = (req.arguments?.expression ?? '').trim();

        if (!this._isPaused) {
            this._respond(req, { result: '<running>', type: 'string', variablesReference: 0 });
            return;
        }

        // Resolve expression: register name, var:name, [N], or bare number
        let addr = ADDR_BY_NAME[expr]
            ?? this._srcToAddr.get(expr)              // var:name from map
            ?? this._srcToAddr.get('var:' + expr);    // bare name → try as var
        if (addr === undefined) {
            const m = expr.match(/^\[(\d+)\]$/) ?? expr.match(/^(\d+)$/);
            if (m) addr = parseInt(m[1]);
        }

        if (addr === undefined) {
            this._send({ type: 'response', request_seq: req.seq,
                         success: false, command: req.command,
                         message: `Unknown: ${expr}. Use a register name (e.g. REG_A) or address (e.g. [42] or 42)` });
            return;
        }

        let result = '""';
        this._stateCallback = line => {
            if (line.startsWith('RAM ')) {
                const parts = line.split(' ');
                result = interpretValue(addr, parts.slice(2).join(' '));
            } else if (line === 'END') {
                this._respond(req, { result, type: 'string', variablesReference: 0 });
            }
        };
        this._toKagu(`STATE ${addr} ${addr}`);
    }

    _handleDisconnect(req) {
        this._toKagu('QUIT');
        this._socket?.destroy();
        this._proc?.kill();
        this._terminal?.dispose();
        this._terminal = null;
        this._respond(req);
    }

    dispose() {
        this._socket?.destroy();
        this._proc?.kill();
        this._terminal?.dispose();
        this._terminal = null;
    }
}

// ============================================================================

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
    // Debug adapter
    context.subscriptions.push(
        vscode.debug.registerDebugAdapterDescriptorFactory('kagu', {
            createDebugAdapterDescriptor(_session) {
                return new vscode.DebugAdapterInlineImplementation(new KaguDebugAdapter());
            }
        })
    );

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
                        const value = tokens[1] || '';
                        if (value.startsWith('OP_')) {
                            const item = constantItem('REG_OP', 'Register');
                            item.preselect = true;
                            item.sortText = '!0';
                            return [
                                item,
                                ...REGISTERS.filter(r => r !== 'REG_OP').map(r => constantItem(r, 'Register')),
                                snippet('var:', 'var:${1:name}', 'Variable reference'),
                            ];
                        }
                        if (value.startsWith('COLOR_')) {
                            const color = constantItem('DISPLAY_COLOR', 'Register');
                            color.preselect = true;
                            const bg = constantItem('DISPLAY_BACKGROUND', 'Register');
                            return [color, bg];
                        }
                        return [
                            ...REGISTERS.map(r => constantItem(r, 'Register')),
                            snippet('var:', 'var:${1:name}', 'Variable reference'),
                        ];
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
