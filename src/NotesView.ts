import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport} from "./Viewport";
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

  getPlayhead(p: p5) {
      return (Tone.now() - this.startTime) * this.tempo + this.playheadStart;
  }
};

type CommandHooks<T> = { 
    keyDown?: T,
    keyUp?: T,
    mouseDown?: T,
    mouseUp?: T,
    step?: T,
}

function mapHooks<A,B>(f: (x:A) => B, hooks: CommandHooks<A>): CommandHooks<B> {
    let ret : CommandHooks<B> = {};
    if ('keyDown' in hooks)   ret['keyDown']   = f(hooks['keyDown']);
    if ('keyUp' in hooks)     ret['keyUp']     = f(hooks['keyUp']);
    if ('mouseDown' in hooks) ret['mouseDown'] = f(hooks['mouseDown']);
    if ('mouseUp' in hooks)   ret['mouseUp']   = f(hooks['mouseUp']);
    if ('step' in hooks)      ret['step']      = f(hooks['step']);
    return ret;
}


type CommandStatus<T> =
    { control: 'REPEAT' } |
    { control: 'CANCEL' } |
    { control: 'PROCEED', value: T } |
    { control: 'CONSUME', value: T };

function mapStatus<A,B> (f: (x:A) => B, status:CommandStatus<A>): CommandStatus<B> {
    if (status.control == 'CONSUME' || status.control == 'PROCEED') { 
        return { control: status.control, value: f(status.value) };
    }
    else {
        return status;
    }
}

interface CommandContext {
    listen<T>(hooks: CommandHooks<() => CommandStatus<T>>): Promise<T>;
}

type Command = (cx: CommandContext) => Promise<void>;

type CommandState = CommandHooks<() => CommandStatus<CommandState>>;

class CommandRunner {
    private commands: { 
        command: Command, 
        state: CommandState,
    }[];

    constructor() {
        this.commands = [];
    }

    private initState(command: Command): CommandState {
        let state: CommandState = null;
        const promise = command({
            listen: <T>(hooks: CommandHooks<() => CommandStatus<T>>) => new Promise((resolve, reject) => {
                    const hookMap = (cb: () => CommandStatus<T>) => () => {
                        const status = cb();

                        // status is e.g. PROCEED 42
                        return mapStatus((x: T) => {
                            // @ts-ignore
                            resolve(x);
                            return state;
                        }, status);
                    };
                    state = mapHooks(hookMap, hooks);
                }),
        }).then(() => {
            // Start over when finished.
            state = this.initState(command);
        });

        return state;
    }

    register(command: Command) {
        this.commands.push({
            command: command,
            state: this.initState(command),
        });
    }

    dispatch(hook: keyof CommandHooks<void>) {
        for (const c of this.commands) {
            if (hook in c.state) {
                const status = c.state[hook]();
                switch (status.control) {
                    case 'REPEAT':
                        break;  // no change
                    case 'CANCEL':
                        c.state = this.initState(c.command);
                        break;
                    case 'PROCEED':
                        break;  // no change
                    case 'CONSUME':
                        return; // stop processing this event.
                }
            }
        }
    }
}


type SerializedNote = { startTime: number, endTime: number, pitch: string, velocity: number };
type Serialized = { notes: SerializedNote[] };


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;
  private isSelecting: boolean;
  private selectStart: { x: number, y: number };
  private selectedNotes: Note[];
  private instrument: Instrument;

  constructor(quantizationGrid: QuantizationGrid) {
    this.quantizationGrid = quantizationGrid;
    this.notes = [];
    this.isDragging = false;
    this.dragStart = null;
    this.selectedNotes = [];
    this.instrument = new ToneSynth();
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
      this.isDragging = false;
      this.dragStart = null;
      this.selectedNotes = [];
  }

  getMouseCoords(p: p5, viewport: Viewport): Point {
    return { 
      x: this.quantizationGrid.snapX(viewport.mapXinv(p.mouseX, p)),
      y: this.quantizationGrid.snapY(viewport.mapYinv(p.mouseY, p))
    };
  }

  getMouseCoordsUnquantized(p: p5, viewport: Viewport): { x: number, y: number} {
    return { 
      x: viewport.mapXinv(p.mouseX, p),
      y: viewport.mapYinv(p.mouseY, p),
    };
  }

  getDrawingNote(p: p5, viewport: Viewport): Note {
    const current = this.getMouseCoords(p, viewport);
    return {
      startTime: Math.min(this.dragStart.x, current.x),
      endTime: Math.max(this.dragStart.x, current.x),
      pitch: this.dragStart.y,
      velocity: 0.75,
    };
  }

  handleMousePressed(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
        this.isDragging = false;
        this.dragStart = null;
        return;
    }

    for (const note of this.notes) {
        const noteBox = this.getNoteBox(note, p, viewport);
        if (noteBox.x0 <= p.mouseX && p.mouseX <= noteBox.xf 
         && noteBox.y0 <= p.mouseY && p.mouseY <= noteBox.yf) {
            this.instrument.playNote(Tone.now(), 0.33, note.pitch.toNumber(), note.velocity);
            if (p.keyIsDown(p.SHIFT)) {
                if (this.selectedNotes.includes(note)) {
                    this.selectedNotes = this.selectedNotes.filter(n => n != note);
                }
                else {
                    this.selectedNotes.push(note);
                }
            }
            else if (! this.selectedNotes.includes(note)) {
                this.selectedNotes = [note];
            }

            // Start moving drag
            if (this.selectedNotes.includes(note)) {
                this.isDragging = true;
                this.dragStart = this.getMouseCoords(p, viewport);
            }
            return;
        }
    }

    if (p.keyIsDown(p.SHIFT)) {
        this.isSelecting = true;
        this.selectStart = this.getMouseCoordsUnquantized(p, viewport);
        return;
    }

    if (p.keyIsDown(p.OPTION)) {
        this.quantizationGrid.setYSnap(this.getMouseCoords(p, viewport).y);
        return;
    }

    // Start note creation drag
    const coords = this.getMouseCoords(p, viewport);
    this.instrument.startNote(Tone.now(), coords.y.toNumber(), 0.75);
    this.isDragging = true;
    this.selectedNotes = [];
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseMoved(p: p5, viewport: Viewport): void {
      if (this.isDragging && this.selectedNotes.length > 0) {
          const coords = this.getMouseCoords(p, viewport);
          if (coords.x != this.dragStart.x || coords.y != this.dragStart.y) {
              const diffX = coords.x - this.dragStart.x;
              const diffY = coords.y.div(this.dragStart.y).normalize();
              for (const note of this.selectedNotes) {
                  note.startTime += diffX;
                  note.endTime += diffX;
                  note.pitch = note.pitch.mul(diffY).normalize();
              }

              this.dragStart = coords;
          }
      }
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging && this.selectedNotes.length == 0) {
      const newNote = this.getDrawingNote(p, viewport);
      this.instrument.stopNote(Tone.now(), newNote.pitch.toNumber());

      if (newNote.startTime != newNote.endTime) {
        this.notes.push(newNote);
        this.selectedNotes = [newNote];
      }
    }
    else if (this.isSelecting) {
        this.selectedNotes = this.notes.filter(n => this.isNoteInSelectionBox(p, viewport, n));
    }

    this.isSelecting = false;
    this.isDragging = false;
  }

  isNoteInSelectionBox(p: p5, viewport: Viewport, note: Note) {
      const boxEnd = this.getMouseCoordsUnquantized(p, viewport);
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

  handleKeyPressed(p: p5, viewport: Viewport): void {
      if (p.keyCode === p.ESCAPE) {
          this.selectedNotes = [];
          this.isDragging = false;
          this.dragStart = null;
      }
      else if (p.keyCode === p.BACKSPACE) {
          this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
          this.selectedNotes = [];
      }
      else if (p.keyCode == 68) { // d  -- duplicate
          if (this.selectedNotes.length > 0) {
              for (const n of this.selectedNotes) {
                  this.notes.push({
                      startTime: n.startTime,
                      endTime: n.endTime,
                      pitch: n.pitch,
                      velocity: n.velocity,
                  });
              }
              this.isDragging = true;
              this.dragStart = this.getMouseCoords(p, viewport);
          }
      }
      else if (p.keyCode == 71) { // g  -- gcd
          if (this.selectedNotes.length > 0) {
              const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
              this.quantizationGrid.setYSnap(gcd);
          }
      }
      else if (p.keyCode == 76) { // l  -- lcm
          if (this.selectedNotes.length > 0) {
              const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch).normalize(), N("1"));
              this.quantizationGrid.setYSnap(lcm);
          }
      }
      else if (p.keyCode == 188) { // ,   -- decrease velocity
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 0 * 0.2;
          }
      }
      else if (p.keyCode == 190) { // .   -- increase velocity
          for (let note of this.selectedNotes) {
              note.velocity = note.velocity * 0.8 + 1 * 0.2;
          }
      }
      else if (p.keyCode == 65)  { // a    -- pivot up
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
              return;
          }

      }
      else if (p.keyCode == 90)  { // z    -- pivot down
          if (this.selectedNotes.length != 1) {
              alert('Pivot: exactly one note must be selected');
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
              return;
          }
      }
      else if (p.keyCode == 67)  { // c    -- chord
          if (this.selectedNotes.length == 0) {
              alert('Chord: at least one note must be selected');
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
      }
  }

  play(p: p5, viewport: Viewport): Player {
      const player = new Player(this.notes, 4, this.instrument, viewport.mapXinv(0, p));
      return player;
  }

  getNoteBox(note: Note, p:p5, viewport: Viewport): { x0: number, y0: number, xf: number, yf: number } {
      return {
          x0: viewport.mapX(note.startTime, p),
          y0: viewport.mapY(note.pitch.toNumber(), p) - NOTE_HEIGHT / 2,
          xf: viewport.mapX(note.endTime, p), 
          yf: viewport.mapY(note.pitch.toNumber(), p) + NOTE_HEIGHT / 2
      }
  }

  getRatioString(notes: Note[]) {
      const gcd = notes.reduce((accum,n) => N.gcd(accum, n.pitch).normalize(), N("0"));
      const nums = notes.map(n => n.pitch.div(gcd).toNumber());
      return [...new Set(nums)].sort((a,b) => a < b ? -1 : a > b ? 1 : 0).join(':');
  }

  draw(p: p5, viewport: Viewport): void {
    this.handleMouseMoved(p, viewport);

    p.colorMode(p.RGB);
    const drawNote = (note: Note, current: boolean) => {
      let v = note.velocity;

      if (current || this.selectedNotes.includes(note)) {
        p.strokeWeight(2);
        p.stroke(255, 128, 0);
        p.fill(255*v, 128*v, 0);
      }
      else {
        p.strokeWeight(1);
        p.stroke(0, 0, 0);
        p.fill(0, v*204, v*255);
      }

      const noteBox = this.getNoteBox(note, p, viewport);
      p.rect(noteBox.x0, noteBox.y0, noteBox.xf - noteBox.x0, noteBox.yf - noteBox.y0);
    };

    if (this.isDragging) {
        drawNote(this.getDrawingNote(p, viewport), true);
    }

    for (const note of this.notes) {
        drawNote(note, false);
    }

    if (this.isSelecting) {
        const boxEnd = this.getMouseCoordsUnquantized(p, viewport);
        p.strokeWeight(2);
        p.stroke(255, 128, 0);
        p.fill(255, 128, 0, 128);
        const x0 = viewport.mapX(this.selectStart.x, p);
        const y0 = viewport.mapY(this.selectStart.y, p)
        p.rect(x0, y0, viewport.mapX(boxEnd.x, p) - x0, viewport.mapY(boxEnd.y, p) - y0);
    }

    if (this.selectedNotes.length >= 2) {
        p.fill(0, 0, 0);
        p.stroke(0, 0, 0);
        p.strokeWeight(1);
        p.textAlign(p.RIGHT);
        p.text(this.getRatioString(this.selectedNotes), 0, 10, p.width, 50);
    }
  }
}
