import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport, LogViewport, LinearViewport} from "./Viewport";
import {ToneSynth, MPEInstrument, Instrument} from "./Instrument";
import {ExactNumber as N, ExactNumberType} from "exactnumber";
import * as Tone from "tone";
import Heap from "heap-js";

const NOTE_HEIGHT = 10;

interface Note {
  startTime: number;
  endTime: number;
  pitch: ExactNumberType;
  velocity: number; // 0-1
}

interface Point {
  x: number;
  y: ExactNumberType;
}

type Event = { time: number, action: (when: number) => void };

class Scheduler {
    private clock: Tone.Clock;
    private resolution: number;
    private heap: Heap<Event>;
    private time: number;

    private willStop: (when: number) => void;

    constructor(resolution: number) {
        this.resolution = resolution;
        this.clock = new Tone.Clock((when: number) => { this.tick() }, 1/this.resolution);
        this.clock.start();
        this.heap = new Heap((a,b) => a.time - b.time);
        this.time = null;
        this.willStop = null;
    }

    stop(cleanup: (when: number) => void): void {
        this.willStop = cleanup;
    }

    tick(): void {
        this.time = Tone.now();
        const nextTime = this.time + this.resolution;

        if (this.willStop) {
            this.clock.stop();
            this.willStop(nextTime);
            return;
        }

        while (true) {
            const event = this.heap.peek();
            if (! event || event.time >= nextTime) {
                break;
            }
            this.heap.pop();
            event.action(event.time);
        }
        this.time = nextTime;
    }

    schedule(when: number, action: (when: number) => void) {
        if (when < Tone.now()) {
            action(Tone.now());
        }
        else {
            this.heap.push({ time: when, action: action });
        }
    }
}

// Bit of a hack to make it so repeated notes don't futz things up.
// Doesn't work 100%.
const NOTE_END_EPSILON = 0.05;

export class Player {
  private notes: Note[];
  private playingNotes: Note[];
  private startTime: number;
  private playheadStart: number;
  private scheduler: Scheduler;
  private instrument: Instrument;
  private tempo: number;

  constructor(notes: Note[], tempo: number, instrument: Instrument, playheadStart: number) {
    this.notes = notes;
    this.playingNotes = [];

    this.scheduler = new Scheduler(0.2);
    this.instrument = instrument;

    this.startTime = Tone.now();
    this.playheadStart = playheadStart;
    this.tempo = tempo;

    for (const note of this.notes) {
        const pitch = note.pitch.toNumber();
        if (note.startTime >= playheadStart) {
            this.scheduler.schedule(this.startTime + (note.startTime - playheadStart) / tempo, (when: number) => {
                instrument.startNote(when, pitch, note.velocity);
            });
            this.scheduler.schedule(this.startTime + (note.endTime - playheadStart) / tempo - NOTE_END_EPSILON, (when: number) => {
                instrument.stopNote(when, pitch);
            });
        }
    }
  }

  stop() {
      this.scheduler.stop((when: number) => { 
          this.instrument.stopAllNotes(when);
      });
  }

  getPlayhead(): number {
      return (Tone.now() - this.startTime) * this.tempo + this.playheadStart;
  }
};

type CommandHooks<T> = { 
    keyDown?: T,
    keyUp?: T,
    mouseDown?: T,
    mouseUp?: T,
    draw?: T,
    action?: { value: T, priority: number },
}

function mapHooks<A,B>(f: (x:A) => B, hooks: CommandHooks<A>): CommandHooks<B> {
    let ret : CommandHooks<B> = {};
    if ('keyDown' in hooks)   ret.keyDown   = f(hooks.keyDown);
    if ('keyUp' in hooks)     ret.keyUp     = f(hooks.keyUp);
    if ('mouseDown' in hooks) ret.mouseDown = f(hooks.mouseDown);
    if ('mouseUp' in hooks)   ret.mouseUp   = f(hooks.mouseUp);
    if ('draw' in hooks)      ret.draw      = f(hooks.draw);
    if ('action' in hooks)    ret.action    = { value: f(hooks.action.value), priority: hooks.action.priority };
    return ret;
}


type CommandStatus<T> =
    { control: 'REPEAT' } | { control: 'CANCEL'} |
    { control: 'PROCEED', value: T } | { control: 'CONSUME', value: T }

function mapStatus<A,B> (f: (x:A) => B, status:CommandStatus<A>): CommandStatus<B> {
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

type Listener<T> = CommandHooks<() => CommandStatus<T>>;

class CommandContext {
    private command: CommandWithState;
    private commandRunner: CommandRunner;

    constructor(command: CommandWithState, commandRunner: CommandRunner) {
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
            const hookMap = (cb: () => CommandStatus<T>) => () => {
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


type Command = (cx: CommandContext) => Promise<void>;

type CommandState = CommandHooks<() => CommandStatus<CommandState>>;

type CommandWithState = { command: Command, state: CommandState };

class CommandRunner {
    private commands: CommandWithState[];

    constructor() {
        this.commands = [];
    }

    private initState(command: CommandWithState){
        command.command(new CommandContext(command, this)).then(() => {
            // Start over when finished.
            // TODO cancel so cleanup can happen!
            this.initState(command);
        });
    }

    register(description: string, command: Command) {
        const cs = {
            command: command,
            state: {},
        };
        this.initState(cs);
        this.commands.push(cs);
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
            // Nothing to do.
        }
        else if (maxActions.length == 1) {
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
        else {
            console.log("More than one competing best action", maxActions);
        }
    }

    dispatch(hook: keyof CommandHooks<void>) {
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


function intervalIntersects(a1: number, b1: number, a2: number, b2:number): boolean {
  return ! (a2 > b1 || a1 > b2);
}

function dedup<T>(xs: T[]): T[] {
    return [...new Set(xs)];
}


type SerializedNote = { startTime: number, endTime: number, pitch: string, velocity: number };
type Serialized = { notes: SerializedNote[] };


export class NotesView {
  private p5: p5;
  private quantizationGrid: QuantizationGrid;
  private viewport: Viewport;
  private notes: Note[];
  private selectedNotes: Note[];
  private instrument: Instrument;
  private commands: CommandRunner;

  constructor(p: p5) {
    this.p5 = p;
    this.viewport = new LogViewport(0, 36, 40, 108);
    this.quantizationGrid = new QuantizationGrid(1, N("216"));
    this.notes = [];
    this.selectedNotes = [];
    this.instrument = new ToneSynth();
    this.commands = new CommandRunner();

    this.registerCommands();
  }
  
  setInstrument(instrument: Instrument) {
      this.instrument = instrument;
  }

  serialize(): Serialized {
      return {
          notes: this.notes.map((n: Note) => ({ 
              startTime: n.startTime, 
              endTime: n.endTime, 
              pitch: n.pitch.toString(),
              velocity: n.velocity,
          }))
      };
  }

  deserialize(s: Serialized): void {
      this.notes = s.notes.map((n: SerializedNote) => ({
          startTime: n.startTime,
          endTime: n.endTime,
          pitch: N(n.pitch),
          velocity: n.velocity,
      }));
      this.selectedNotes = [];
  }

  getMouseCoords(): Point {
    return { 
      x: this.quantizationGrid.snapX(this.viewport.mapXinv(this.p5.mouseX, this.p5)),
      y: this.quantizationGrid.snapY(this.viewport.mapYinv(this.p5.mouseY, this.p5))
    };
  }

  getMouseCoordsUnquantized(): { x: number, y: number} {
    return { 
      x: this.viewport.mapXinv(this.p5.mouseX, this.p5),
      y: this.viewport.mapYinv(this.p5.mouseY, this.p5),
    };
  }

  handleMousePressed(): void {
    this.commands.dispatch('mouseDown');

    if (this.p5.keyIsDown(this.p5.OPTION)) {
        this.quantizationGrid.setYSnap(this.getMouseCoords().y);
        return;
    }
  }

  handleMouseReleased(): void {
    this.commands.dispatch('mouseUp');
  }
  
  registerCommands() {
      const simpleKey = (name: string, key: number, cb: () => void) => {
          this.commands.register(name, async (cx:CommandContext) => {
              await cx.listen(cx.key(this.p5, key));
              await cx.action(cb);
          });
      };

      simpleKey('GCD (g)', 71, () => { 
          if (this.selectedNotes.length > 0) {
              const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
              this.quantizationGrid.setYSnap(gcd);
          }
      });

      simpleKey('LCM (l)', 76, () => {
          if (this.selectedNotes.length > 0) {
              const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch).normalize(), N("1"));
              this.quantizationGrid.setYSnap(lcm);
          }
      });
      
      simpleKey('Delete (backspace)', 8, () => {
          this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
          this.selectedNotes = [];
      });

      simpleKey('Decrease Velocity (,)', 188, () => {
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 0 * 0.2;
          }
      });

      simpleKey('Increase Velocity (.)', 190, () => {
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 1 * 0.2;
          }
      });

      simpleKey('Shift pitch grid down by 1 harmonic (a)', 65, () => {
          if (this.selectedNotes.length != 1) {
              alert('Pivot: exactly one note must be selected');
              return;
          }
          const note = this.selectedNotes[0];
          const z = note.pitch.div(this.quantizationGrid.getYSnap()).normalize();
          if (z.isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.div(z.add(N("1"))).normalize());
          }
          else if (z.inv().isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.mul(z.inv().sub(N("1"))).normalize());
          }
          else {
              alert('Pivot: selected note must be on grid line');
          }
      });

      simpleKey('Shift pitch gtid up by 1 harmonic (z)', 90, () => {
          if (this.selectedNotes.length != 1) {
              //alert('Pivot: exactly one note must be selected');
              return;
          }
          const note = this.selectedNotes[0];
          const z = note.pitch.div(this.quantizationGrid.getYSnap()).normalize();
          if (z.inv().isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.mul(z.inv().add(N("1"))).normalize());
          }
          else if (z.isInteger()) {
              this.quantizationGrid.setYSnap(note.pitch.div(z.sub(N("1"))).normalize());
          }
          else {
              alert('Pivot: selected note must be on grid line');
          }
      });

      simpleKey('Construct chord (c)', 67, () => {
          if (this.selectedNotes.length == 0) {
              alert('Chord: at least one note must be selected');
              return;
          }

          const ratioString = window.prompt('Enter a ratio string such as 2:3:4');
          if (ratioString === null) {
              return;
          }

          const componentStrings = ratioString.split(':');
          let ratios: number[] = [];
          for (const component of componentStrings) {
              if (! component.match(/^\d+$/) || Number(component) == 0) {
                  alert('Chord: Invalid ratio string. I don\'t understand "' + component + '"');
                  return;
              }
              ratios.push(Number(component));
          }
          const [r0] = ratios.splice(0, 1);

          const sel = this.selectedNotes;
          this.selectedNotes = [];
          for (const note of sel) {
              for (const r of ratios) {
                  const newNote = {
                      startTime: note.startTime,
                      endTime: note.endTime,
                      pitch: note.pitch.div(r0).mul(r).normalize(),
                      velocity: note.velocity
                  };
                  this.notes.push(newNote);
                  this.selectedNotes.push(newNote);
              }
          }
      });

      this.commands.register('Add/remove note from selection', async (cx: CommandContext) => {
          const note = await cx.listen(
                                cx.when(() => this.p5.keyIsDown(this.p5.SHIFT), 
                                        this.listenSelectNote(cx)));
          if (this.selectedNotes.includes(note)) {
              await cx.action(() => { 
                  this.selectedNotes = this.selectedNotes.filter(n => n != note) });
          }
          else {
              await cx.action(() => {
                  this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);
                  this.selectedNotes.push(note);
              });
          }
      });

      this.commands.register('Resize notes', async (cx: CommandContext) => {
          const onHandle = (note: Note) => {
              const noteBox = this.getNoteBox(note);
              if (noteBox.xf - 10 <= this.p5.mouseX && this.p5.mouseX <= noteBox.xf
                    && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
                  return 'RIGHT';
              }
              else if (noteBox.x0 <= this.p5.mouseX && this.p5.mouseX <= noteBox.x0 + 10
                    && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
                  return 'LEFT';
              }
              else {
                  return false;
              }
          };
          const [note, handle] = await cx.listen({
              draw: () => {
                  for (const note of this.notes) {
                      if (onHandle(note)) {
                          this.p5.cursor('col-resize');
                          return { control: 'REPEAT' };
                      }
                  }
                  return { control: 'REPEAT' };
              },
              mouseDown: () => {
                  for (const note of this.notes) {
                      const handle = onHandle(note);
                      if (handle) {
                          return { control: 'CONSUME', value: [note, handle] };
                      }
                  }
                  return { control: 'REPEAT' };
              }
          });
          const startCoords = this.getMouseCoords();
          const selection = this.selectedNotes.includes(note) ? this.selectedNotes : [note];
          const refTimes = selection.map(n => ({ startTime: n.startTime, endTime: n.endTime }));

          await cx.listen({
              action: { priority: 0, value: () => {
                  const coords = this.getMouseCoords();

                  for (let i = 0; i < selection.length; i++) {
                      if (handle === 'LEFT') {
                          const newStart = refTimes[i].startTime + coords.x - startCoords.x;
                          if (newStart < selection[i].endTime) {
                              selection[i].startTime = newStart;
                          }
                          else {
                              selection[i].startTime = refTimes[i].endTime - this.quantizationGrid.getXSnap();
                          }
                      }
                      else {
                          const newEnd = refTimes[i].endTime + coords.x - startCoords.x;
                          if (newEnd > selection[i].startTime) {
                              selection[i].endTime = newEnd;
                          }
                          else {
                              selection[i].endTime = refTimes[i].startTime + this.quantizationGrid.getXSnap();
                          }
                      }
                  }
                  return { control: 'REPEAT' };
              } },
              draw: () => {
                  this.p5.cursor('col-resize');
                  return { control: 'REPEAT' };
              },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined };
              },
          });
      });
      

      this.commands.register('Duplicate notes', async (cx: CommandContext) => {
          await cx.listen(cx.when(() => this.selectedNotes.length != 0, cx.key(this.p5, 68)));  // d

          const notes = await cx.action(() => {
              const r = [...this.selectedNotes];
              this.selectedNotes = [];
              return r;
          });
          const initialMouse: Point = this.getMouseCoords();
          const translate = (note: Note, mouse: Point) => ({
              startTime: note.startTime + mouse.x - initialMouse.x,
              endTime: note.endTime + mouse.x - initialMouse.x,
              pitch: note.pitch,
              velocity: note.velocity,
          });
          await cx.listen({
              draw: () => {
                  const mouse = this.getMouseCoords();
                  for (const note of notes) {
                      this.drawNote(translate(note, mouse), true);
                  }
                  return { control: 'REPEAT' };
              },
              mouseDown: () => {
                  return { control: 'CONSUME', value: undefined };
              },
              keyDown: () => {
                  if (this.p5.keyCode == 27) { // esc
                      return { control: 'CANCEL' };
                  }
                  else {
                      return { control: 'REPEAT' };
                  }
              },
          });
          await cx.action(() => {
              const mouse = this.getMouseCoords();
              this.selectedNotes = notes.map(n => translate(n, mouse));
              this.notes = this.notes.concat(this.selectedNotes);
          });
      });

      
      this.commands.register('Select and move notes', async (cx: CommandContext) => {
          const note = await cx.listen(this.listenSelectNote(cx));
          this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);

          let lastMouse: Point = await cx.action(() => {
              if (! this.selectedNotes.includes(note)) {
                  this.selectedNotes = [note];
              }
              return this.getMouseCoords();
          });

          await cx.listen({
              action: { priority: 0, value: () => {
                  const coords = this.getMouseCoords();
                  for (const n of this.selectedNotes) {
                      n.startTime += coords.x - lastMouse.x;
                      n.endTime += coords.x - lastMouse.x;
                      n.pitch = n.pitch.mul(coords.y.div(lastMouse.y)).normalize();
                  }
                  lastMouse = coords;
                  return { control: 'REPEAT' };
              } },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined };
              }
          });
      });

      this.commands.register('Create new note', async (cx: CommandContext) => {
          await cx.listen(cx.when(() => ! this.p5.keyIsDown(this.p5.SHIFT), cx.mouseDown()));
          const startCoords: Point  = await cx.action(() => {
              const coords = this.getMouseCoords();

              this.selectedNotes = [];
              this.instrument.playNote(Tone.now(), 0.33, coords.y.toNumber(), 0.75);
              return coords;
          });

          const mkNote = () => { 
              const coords = this.getMouseCoords();
              return {
                  startTime: Math.min(startCoords.x, coords.x),
                  endTime: Math.max(startCoords.x, coords.x),
                  pitch: startCoords.y,
                  velocity: 0.75,
              };
          };

          await cx.listen({
              draw: () => {
                  this.drawNote(mkNote(), true);
                  return { control: 'REPEAT' };
              },
              mouseUp: () => {
                  const note = mkNote();
                  if (note.startTime != note.endTime) {
                      this.notes.push(note);
                      this.selectedNotes = [note];
                  }
                  return { control: 'CONSUME', value: undefined };
              }
          });
      });

      this.commands.register('Box select notes', async (cx: CommandContext) => {
          await cx.listen(cx.when(
              () => this.p5.keyIsDown(this.p5.SHIFT) && this.mouseOverNote() === null, 
              cx.mouseDown()));
          const startCoords = this.getMouseCoordsUnquantized();
          const startingNotes = this.selectedNotes;

          await cx.listen({
              action: { priority: 0, value: () => {
                  const boxEnd = this.getMouseCoordsUnquantized();
                  const minX = Math.min(startCoords.x, boxEnd.x);
                  const maxX = Math.max(startCoords.x, boxEnd.x);
                  const minY = Math.min(startCoords.y, boxEnd.y);
                  const maxY = Math.max(startCoords.y, boxEnd.y);
              
                  this.selectedNotes = dedup(startingNotes.concat(this.notes.filter(note => {
                      const pitch = note.pitch.toNumber();
                      return (intervalIntersects(minX, maxX, note.startTime, note.endTime) 
                           && intervalIntersects(minY, maxY, pitch, pitch));
                  })));

                  return { control: 'REPEAT' }
              } },
              draw: () => {
                  const boxEnd = this.getMouseCoordsUnquantized();
                  this.p5.strokeWeight(2);
                  this.p5.stroke(255, 128, 0);
                  this.p5.fill(255, 128, 0, 128);
                  const x0 = this.viewport.mapX(startCoords.x, this.p5);
                  const y0 = this.viewport.mapY(startCoords.y, this.p5)
                  this.p5.rect(x0, y0, this.viewport.mapX(boxEnd.x, this.p5) - x0, this.viewport.mapY(boxEnd.y, this.p5) - y0);
                  return { control: 'REPEAT' }
              },
              mouseUp: () => {
                  return { control: 'CONSUME', value: undefined }
              },
          });
      });
  }

  listenSelectNote(cx: CommandContext): Listener<Note> {
      return {
              mouseDown: () => {
                  const note = this.mouseOverNote();
                  if (note === null) {
                      return { control: 'REPEAT' };
                  }
                  else {
                      return { control: 'CONSUME', value: note };
                  }
              }
          };
  }

  mouseOverNote(): Note {
      for (const note of this.notes) {
          const noteBox = this.getNoteBox(note);
          if (noteBox.x0 <= this.p5.mouseX && this.p5.mouseX <= noteBox.xf 
           && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
              return note;
          }
      }
      return null;
  }


  handleKeyPressed(): void {
      this.commands.dispatch('keyDown');

      const subdivKey = (subdiv: ExactNumberType) => {
          if (this.p5.keyIsDown(this.p5.CONTROL)) {
              if (this.p5.keyIsDown(this.p5.SHIFT)) {
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() * subdiv.toNumber());
              }
              else {
                  this.quantizationGrid.setXSnap(this.quantizationGrid.getXSnap() / subdiv.toNumber());
              }
          }
          else {
              if (this.p5.keyIsDown(this.p5.SHIFT)) {
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().mul(subdiv));
              }
              else {
                  this.quantizationGrid.setYSnap(this.quantizationGrid.getYSnap().div(subdiv));
              }
          }
      };

      switch (this.p5.keyCode) {
          case 37: { // <-
              this.viewport.translateX(-0.25);
              break;
          }
          case 39: { // ->
              this.viewport.translateX(0.25);
              break;
          }
          case 38: { // ^
              this.viewport.translateY(0.25);
              break;
          }
          case 40: { // v
              this.viewport.translateY(-0.25);
              break;
          }
          case 86: { // 'v'
              const xmin = this.viewport.mapXinv(0, this.p5);
              const xmax = this.viewport.mapXinv(this.p5.width, this.p5);
              const ymin = this.viewport.mapYinv(this.p5.height, this.p5);
              const ymax = this.viewport.mapYinv(0, this.p5);
              if (this.viewport instanceof LogViewport) {
                  this.viewport = new LinearViewport(xmin, ymin, xmax, ymax);
              }
              else {
                  const noteMin = ymin < 0 ? 1 : 12 * Math.log2(ymin / 440) + 69;
                  const noteMax = ymax < 0 ? 1 : 12 * Math.log2(ymax / 440) + 69;
                  this.viewport = new LogViewport(xmin, noteMin, xmax, noteMax); 
              }
              break;
          }
          case 50: { // 2
              subdivKey(N('2'));
              break;
          }
          case 51: { // 3
              subdivKey(N('3'));
              break;
          }
          case 83: {// s -- save
              if (this.p5.keyIsDown(this.p5.CONTROL)) {
                  document.location.hash = Buffer.from(JSON.stringify(this.serialize())).toString("base64");
              }
          }
      }
  }

  play(): Player {
      return new Player(this.notes, 4, this.instrument, this.viewport.mapXinv(0, this.p5));
  }

  getNoteBox(note: Note): { x0: number, y0: number, xf: number, yf: number } {
      return {
          x0: this.viewport.mapX(note.startTime, this.p5),
          y0: this.viewport.mapY(note.pitch.toNumber(), this.p5) - NOTE_HEIGHT / 2,
          xf: this.viewport.mapX(note.endTime, this.p5), 
          yf: this.viewport.mapY(note.pitch.toNumber(), this.p5) + NOTE_HEIGHT / 2
      }
  }

  getRatioString(notes: Note[]) {
      const gcd = notes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
      const nums = notes.map(n => n.pitch.div(gcd).toNumber());
      return [...new Set(nums)].sort((a,b) => a < b ? -1 : a > b ? 1 : 0).join(':');
  }

  drawPlayhead(playhead: number) {
      this.p5.colorMode(this.p5.RGB);
      this.p5.strokeWeight(2);
      this.p5.stroke(0, 128, 0);
      this.p5.line(this.viewport.mapX(playhead, this.p5), 0, this.viewport.mapX(playhead, this.p5), this.p5.height);
  }
  
  drawNote(note: Note, current: boolean): void {
      let v = note.velocity;

      if (current || this.selectedNotes.includes(note)) {
        this.p5.strokeWeight(2);
        this.p5.stroke(255, 128, 0);
        this.p5.fill(255*v, 128*v, 0);
      }
      else {
        this.p5.strokeWeight(1);
        this.p5.stroke(0, 0, 0);
        this.p5.fill(0, v*204, v*255);
      }

      const noteBox = this.getNoteBox(note);
      this.p5.rect(noteBox.x0, noteBox.y0, noteBox.xf - noteBox.x0, noteBox.yf - noteBox.y0);
  }

  draw(): void {
    this.p5.cursor('auto');  // to be overridden by commands' draw maybe
    this.quantizationGrid.drawGrid(this.p5, this.viewport);

    this.p5.colorMode(this.p5.RGB);

    for (const note of this.notes) {
        this.drawNote(note, false);
    }

    this.commands.dispatch('draw');

    if (this.selectedNotes.length >= 2) {
        this.p5.fill(0, 0, 0);
        this.p5.stroke(0, 0, 0);
        this.p5.strokeWeight(1);
        this.p5.textAlign(this.p5.RIGHT);
        this.p5.text(this.getRatioString(this.selectedNotes), 0, 10, this.p5.width, 50);
    }
    
  }
}
