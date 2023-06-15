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

    constructor(resolution: number) {
        this.resolution = resolution;
        this.clock = new Tone.Clock((when: number) => { this.tick() }, 1/this.resolution);
        this.clock.start();
        this.heap = new Heap((a,b) => a.time - b.time);
        this.time = null;
    }

    stop(): void {
        this.clock.stop();
    }

    tick(): void {
        if (this.time === null) {
            this.time = Tone.now();
        }

        const nextTime = this.time + this.resolution;
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

export class Player {
  private notes: Note[];
  private playingNotes: Note[];
  private startTime: number;
  private scheduler: Scheduler;
  private instrument: Instrument;
  private tempo: number;

  constructor(notes: Note[], tempo: number, instrument: Instrument) {
    this.notes = notes;
    this.playingNotes = [];

    this.scheduler = new Scheduler(0.2);
    this.instrument = instrument;

    this.startTime = Tone.now();
    this.tempo = tempo;

    for (const note of this.notes) {
        const pitch = note.pitch.toNumber();
        this.scheduler.schedule(this.startTime + note.startTime / tempo, (when: number) => {
            instrument.startNote(when, pitch, note.velocity);
        });
        this.scheduler.schedule(this.startTime + note.endTime / tempo, (when: number) => {
            instrument.stopNote(when, pitch);
        });
    }
  }

  stop() {
      this.scheduler.stop();
      this.instrument.stopAllNotes();
  }

  getPlayhead(p: p5) {
      return (Tone.now() - this.startTime) * this.tempo;
  }
};

type SerializedNote = { startTime: number, endTime: number, pitch: string, velocity: number };
type Serialized = { notes: SerializedNote[] };


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;
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
            else {
                this.selectedNotes = [note];
            }
            return;
        }
    }

    if (p.keyIsDown(p.OPTION)) {
        this.quantizationGrid.setYSnap(this.getMouseCoords(p, viewport).y);
        return;
    }

    const coords = this.getMouseCoords(p, viewport);
    this.instrument.startNote(Tone.now(), coords.y.toNumber(), 0.75);
    this.isDragging = true;
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
      const newNote = this.getDrawingNote(p, viewport);
      this.instrument.stopNote(Tone.now(), newNote.pitch.toNumber());

      if (newNote.startTime != newNote.endTime) {
        this.notes.push(newNote);
        this.selectedNotes = [newNote];
      }
    }
    this.isDragging = false;
  }

  handleKeyPressed(p: p5): void {
      if (p.keyCode === p.ESCAPE) {
          this.selectedNotes = [];
          this.isDragging = false;
          this.dragStart = null;
      }
      else if (p.keyCode === p.BACKSPACE) {
          this.notes = this.notes.filter(n => ! this.selectedNotes.includes(n));
          this.selectedNotes = [];
      }
      else if (p.keyCode == 71) { // g  -- gcd
          if (this.selectedNotes.length > 0) {
              const gcd = this.selectedNotes.reduce((accum,n) => N.gcd(accum, n.pitch), N("0"));
              this.quantizationGrid.setYSnap(gcd);
          }
      }
      else if (p.keyCode == 76) { // l  -- lcm
          if (this.selectedNotes.length > 0) {
              const lcm = this.selectedNotes.reduce((accum,n) => N.lcm(accum, n.pitch), N("1"));
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
  }

  play(p: p5, viewport: Viewport): Player {
      const player = new Player(this.notes, 4, this.instrument);
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

  draw(p: p5, viewport: Viewport): void {
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
  }
}
