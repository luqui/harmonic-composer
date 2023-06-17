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

  /*
  isNoteInSelectionBox(note: Note) {
      const boxEnd = this.getMouseCoordsUnquantized();
      const minX = Math.min(this.selectStart.x, boxEnd.x);
      const maxX = Math.max(this.selectStart.x, boxEnd.x);
      const minY = Math.min(this.selectStart.y, boxEnd.y);
      const maxY = Math.max(this.selectStart.y, boxEnd.y);

      const intervalIntersects = (a1: number, b1: number, a2: number, b2:number) => {
          return ! (a2 > b1 || a1 > b2);
      };

      const pitch = note.pitch.toNumber();
      return (intervalIntersects(minX, maxX, note.startTime, note.endTime) 
              && intervalIntersects(minY, maxY, pitch, pitch));
  }
  */
  
  registerCommands() {
      this.commands.register('GCD', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 71)); // g       
          if (this.selectedNotes.length > 0) {
              const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
              await cx.action(() => this.quantizationGrid.setYSnap(gcd));
          }
      });

      this.commands.register('LCM', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 76)); // l
          if (this.selectedNotes.length > 0) {
              const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch).normalize(), N("1"));
              await cx.action(() => this.quantizationGrid.setYSnap(lcm));
          }
      });
      
      this.commands.register('Delete Notes', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 8));  // backspace
          await cx.action(() => {
              this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
              this.selectedNotes = [];
          });
      });

      this.commands.register('Decrease Velocity', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 188));  // ,
          await cx.action(() => {
              for (let note of this.selectedNotes) {
                  note.velocity = note.velocity * 0.8 + 0 * 0.2;
              }
          });
      });

      this.commands.register('Increase Velocity', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 190));  // .
          await cx.action(() => {
              for (let note of this.selectedNotes) {
                  note.velocity = note.velocity * 0.8 + 1 * 0.2;
              }
          });
      });

      this.commands.register('Shift pitch grid down by 1 harmonic', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 65));  // a
          await cx.action(() => {
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
      });

      this.commands.register('Shift pitch grid up by 1 harmonic', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 90));  // z
          await cx.action(() => {
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
      });

      this.commands.register('Construct chord', async (cx: CommandContext) => {
          await cx.listen(cx.key(this.p5, 67));   // c
          await cx.action(() => {
              if (this.selectedNotes.length == 0) {
                  //alert('Chord: at least one note must be selected');
                  return;
              }

              const startTime = this.selectedNotes[0].startTime;
              const endTime = this.selectedNotes[0].endTime;

              for (const note of this.selectedNotes) {
                  if (note.startTime != startTime || note.endTime != endTime) {
                      alert('Chord: if more than one note is selected, they must all have the same time range.  Sorry, not sure what the behavior should be otherwise.');
                      return;
                  }
              }

              const ratioString = window.prompt('Enter a ratio string such as 2:3:4', this.getRatioString(this.selectedNotes));
              if (ratioString === null) {
                  return;
              }

              let componentStrings = ratioString.split(':');
              let ratios: number[] = [];
              for (const component of componentStrings) {
                  if (! component.match(/^\d+$/) || Number(component) == 0) {
                      alert('Chord: Invalid component ' + component);
                      return;
                  }
                  ratios.push(Number(component));
              }

              this.selectedNotes.sort((a,b) => a.pitch.lt(b.pitch) ? -1 : a.pitch.gt(b.pitch) ? 1 : 0);
              const base = this.selectedNotes[0].pitch.div(ratios[0]);
              this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));

              for (const r of ratios) {
                  const newNote = {
                      startTime: startTime,
                      endTime: endTime,
                      pitch: base.mul(r).normalize(),
                      velocity: 0.75
                  };
                  this.notes.push(newNote);
                  this.selectedNotes.push(newNote);
              }
          });
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
      
      this.commands.register('Select note', async (cx: CommandContext) => {
          const note = await cx.listen(this.listenSelectNote(cx));
          await cx.action(() => {
              this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);
              this.selectedNotes = [note];
          });
      });

      this.commands.register('Create new note', async (cx: CommandContext) => {
          await cx.listen(cx.mouseDown());
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
                  }
                  return { control: 'CONSUME', value: undefined };
              }
          });
      });

      /*

      this.commands.register('Move notes', async (cx: CommandContext) => {
          const note = await cx.consume(
                                cx.when((note) => this.selectedNotes.includes(note),
                                        this.listenSelectNote(cx)));
          await cx.listen({
              draw: () => {
                  // move notes according to mouse position
                  return { control: 'REPEAT' };
              },
              mouseUp: () => {
                  return { control: 'CONSUME', value: null };
              },
              cancel: () => {
                  // put notes back to where they used to be
              }
          });
      });
      */
  }

  listenSelectNote(cx: CommandContext): Listener<Note> {
      return {
              mouseDown: () => {
                  for (const note of this.notes) {
                      const noteBox = this.getNoteBox(note);
                      if (noteBox.x0 <= this.p5.mouseX && this.p5.mouseX <= noteBox.xf 
                       && noteBox.y0 <= this.p5.mouseY && this.p5.mouseY <= noteBox.yf) {
                          return { control: 'CONSUME', value: note };
                       }
                  }
                  return { control: 'REPEAT' };
              }
          };
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
    this.quantizationGrid.drawGrid(this.p5, this.viewport);

    this.p5.colorMode(this.p5.RGB);

    for (const note of this.notes) {
        this.drawNote(note, false);
    }

    /*
    if (this.isSelecting) {
        const boxEnd = this.getMouseCoordsUnquantized();
        this.p5.strokeWeight(2);
        this.p5.stroke(255, 128, 0);
        this.p5.fill(255, 128, 0, 128);
        const x0 = this.viewport.mapX(this.selectStart.x, this.p5);
        const y0 = this.viewport.mapY(this.selectStart.y, this.p5)
        this.p5.rect(x0, y0, this.viewport.mapX(boxEnd.x, this.p5) - x0, this.viewport.mapY(boxEnd.y, this.p5) - y0);
    }
    */
    
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
