import p5 from "p5";
import * as Utils from "./Utils";

export type Hooks<T> = { 
    keyDown?: T,
    keyUp?: T,
    mouseDown?: T,
    mouseUp?: T,
    draw?: T,
    action?: { value: T, priority: number },
}

function mapHooks<A,B>(f: (x:A) => B, hooks: Hooks<A>): Hooks<B> {
    let ret : Hooks<B> = {};
    if ('keyDown' in hooks)   ret.keyDown   = f(hooks.keyDown);
    if ('keyUp' in hooks)     ret.keyUp     = f(hooks.keyUp);
    if ('mouseDown' in hooks) ret.mouseDown = f(hooks.mouseDown);
    if ('mouseUp' in hooks)   ret.mouseUp   = f(hooks.mouseUp);
    if ('draw' in hooks)      ret.draw      = f(hooks.draw);
    if ('action' in hooks)    ret.action    = { value: f(hooks.action.value), priority: hooks.action.priority };
    return ret;
}


export type Status<T> =
    { control: 'REPEAT' } | { control: 'CANCEL'} |
    { control: 'PROCEED', value: T } | { control: 'CONSUME', value: T }

function mapStatus<A,B> (f: (x:A) => B, status:Status<A>): Status<B> {
    if (status === null) {
        return null;
    }
    if (status.control === 'CONSUME' || status.control === 'PROCEED') { 
        return { control: status.control, value: f(status.value) };
    }
    else {
        return status;
    }
}

export type Listener<T> = Hooks<() => Status<T>>;

export class Context {
    private command: CommandWithState;
    private commandRunner: Runner;

    constructor(command: CommandWithState, commandRunner: Runner) {
        this.command = command;
        this.commandRunner = commandRunner;
    }

    async listen<T>(hooks: Listener<T> | Promise<Listener<T>>): Promise<T> {
        let listener: Listener<T>;

        if (hooks instanceof Promise) {
            listener = await hooks;
        }
        else {
            listener = hooks;
        }

        return new Promise((resolve, reject) => {
            let stateCache;
            const hookMap = (cb: () => Status<T>) => () => {
                const status = cb();

                // status is e.g. PROCEED 42
                return mapStatus((x: T) => {
                    // @ts-ignore
                    resolve(x);
                    return this.command.state;
                }, status);
            };
            this.command.state = mapHooks(hookMap, listener);
        });
    }

    key(p: p5, keyCode: number): Listener<null> {
        return {
            keyDown: () => {
                if (p.keyCode == keyCode) { 
                    return { control: 'CONSUME', value: null };
                }
                else {
                    return { control: 'REPEAT' };
                }
            }
        };
    }

    mouseDown(): Listener<null> {
        return {
            mouseDown: () => ({ control: 'CONSUME', value: null })
        }
    }

    when<T>(p: (t: T) => boolean, listener: Listener<T>): Listener<T> {
        return mapHooks(hook => () => {
                   const status = hook();
                   if ('value' in status && p(status.value)) {
                       return status;
                   }
                   else {
                       return { control: 'REPEAT' };
                   }
               }, listener);
    }

    action<T>(code: () => T, priority = 0): Promise<T> {
        return this.listen({
            action: {
                priority: priority,
                value: () => {
                    const x = code();
                    return { control: 'PROCEED', value: x };
                }
            }
        });
    }

}


export type Command = (cx: Context) => Promise<void>;

type CommandState = Hooks<() => Status<CommandState>>;

type CommandWithState = { command: Command, state: CommandState, category: string, description: string };

export class Runner {
    private commands: CommandWithState[];

    constructor() {
        this.commands = [];
    }

    private initState(command: CommandWithState){
        command.command(new Context(command, this)).then(() => {
            // Start over when finished.
            // TODO cancel so cleanup can happen!
            this.initState(command);
        });
    }

    register(description: string, category: string, command: Command) {
        const cs = {
            command: command,
            state: {},
            category: category,
            description: description,
        };
        this.initState(cs);
        this.commands.push(cs);
    }

    getHelpHTML() {
        const div = document.createElement('div');

        const categories = Utils.dedup(this.commands.map(c => c.category)).sort();

        for (const cat of categories) {
            if (cat === 'hidden')
                continue;

            const table = document.createElement('table');
            div.appendChild(table);
            {
                const thead = document.createElement('thead');
                table.appendChild(thead);
                const tr = document.createElement('tr');
                thead.appendChild(tr);
                const td = document.createElement('td');
                tr.appendChild(td);

                td.innerText = cat;
            }

            const tbody = document.createElement('tbody');
            table.appendChild(tbody);
            for (const c of this.commands) {
                if (c.category === cat) {
                    const tr = document.createElement('tr');
                    tbody.appendChild(tr);
                    const td = document.createElement('td');
                    tr.appendChild(td);

                    td.innerText = c.description;
                }
            }
        }
        return div;
    }

    resolveActions() {
        let maxPrio: number = -Infinity;
        let maxActions: CommandWithState[] = [];

        for (const c of this.commands) {
            if ('action' in c.state) {
                if (c.state.action.priority > maxPrio) {
                    for (const d of maxActions) {
                        this.initState(d);
                    }
                    maxActions = [c];
                    maxPrio = c.state.action.priority;
                }
                else if (c.state.action.priority == maxPrio) {
                    maxActions.push(c);
                }
                else {
                    this.initState(c);
                }
            }
        }

        if (maxActions.length == 0) {
            // Nothing to do
            return;
        }
        if (maxActions.length >= 2) {
            console.log("More than one competing best action", maxActions, "(choosing first)");
            for (let i = 1; i < maxActions.length; i++) {
                this.initState(maxActions[i]);
            }
            maxActions = [maxActions[0]];
        }

        // now maxActions.length = 1
        const status = maxActions[0].state.action.value();
        switch (status.control) {
            case 'REPEAT':
                break;
            case 'CANCEL':
                this.initState(maxActions[0]);
                break;
            case 'PROCEED':
                if (maxActions[0].state !== status.value) {
                    throw Error("Invariant error");
                }
                break;
            case 'CONSUME':
                console.log("Actions may not consume", maxActions[0]);
                throw Error("Actions may not consume");
        }
    }

    dispatch(hook: keyof Hooks<void>) {
        for (const c of this.commands) {
            if (hook in c.state) {
                if (hook === 'action')
                    throw Error('Cannot call dispatch on actions, they are resolved automatically');

                const status = c.state[hook]();
                if (status === null)
                    continue;
                switch (status.control) {
                    case 'REPEAT':
                        break;  // no change
                    case 'CANCEL':
                        this.initState(c);
                        break;
                    case 'PROCEED':
                        if (c.state !== status.value) {
                            throw Error("Invariant error");
                        }
                        break;  // no change
                    case 'CONSUME':
                        if (c.state !== status.value) {
                            throw Error("Invariant error");
                        }
                        return; // stop processing this event.
                }
            }
        }
        this.resolveActions();
    }
}

