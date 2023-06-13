import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport} from "./Viewport";
import {Instrument} from "./Instrument";


interface Note {
  startTime: number;
  endTime: number;
  pitch: number;
}

interface Point {
  x: number;
  y: number;
}

export class Player {
  private notes: Note[];
  private playingNotes: Note[];
  private playing: boolean;
  private startTime: number;
  private index: number;
  private instrument: Instrument;

  constructor(notes: Note[]) {
    this.notes = [...notes];
    this.notes.sort((a,b) => 
        a.startTime < b.startTime ? -1 : a.startTime == b.startTime ? 0 : 1);
    this.playingNotes = [];

    this.playing = false;
    this.instrument = new Instrument();
  }

  step(p: p5) {
    if (!this.playing) {
        return;
    }

    let t = p.millis()/1000 - this.startTime;
    while (this.index < this.notes.length && this.notes[this.index].startTime < t) {
      this.instrument.startNote(this.notes[this.index].pitch);
      this.playingNotes.push(this.notes[this.index]);
      this.index++;
    }

    this.playingNotes = this.playingNotes.filter((note: Note) => {
        if (note.endTime < t) {
            this.instrument.stopNote(note.pitch, 0);
            return false;
        }
        else {
            return true;
        }
    });
  }

  play(p: p5) {
    this.playing = true;
    this.startTime = p.millis()/1000;
    this.index = 0;
  }

  stop() {
      for (const n of this.playingNotes) {
          this.instrument.stopNote(n.pitch, 0);
      }
      this.playing = false;
      this.playingNotes = [];
  }
};


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;
  private selectedNote: Note;
  private instrument: Instrument;

  constructor(quantizationGrid: QuantizationGrid) {
    this.quantizationGrid = quantizationGrid;
    this.notes = [];
    this.isDragging = false;
    this.dragStart = null;
    this.selectedNote = null;
    this.instrument = new Instrument();
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
      pitch: this.dragStart.y
    };
  }

  handleMousePressed(p: p5, viewport: Viewport): void {
    const coords = this.getMouseCoords(p, viewport);
    for (const note of this.notes) {
        if (coords.y == note.pitch && note.startTime <= coords.x && note.endTime >= coords.x) {
            this.instrument.playNote(coords.y, 0.33);
            this.selectedNote = note;
            return;
        }
    }

    this.instrument.startNote(coords.y);
    this.isDragging = true;
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
      const newNote = this.getDrawingNote(p, viewport);
      this.instrument.stopNote(newNote.pitch, 0);

      if (newNote.startTime != newNote.endTime) {
        this.notes.push(newNote);
        this.isDragging = false;
        this.selectedNote = newNote;
      }
    }
  }

  handleKeyPressed(p: p5): void {
      if (p.keyCode === p.ESCAPE) {
          this.selectedNote = null;
          this.isDragging = false;
          this.dragStart = null;
      }
      else if (p.keyCode === p.BACKSPACE) {
          this.notes = this.notes.filter(n => n !== this.selectedNote);
          this.selectedNote = null;
      }
  }

  play(p: p5): Player {
      const player = new Player(this.notes);
      player.play(p);
      return player;
  }

  draw(p: p5, viewport: Viewport): void {
    const noteHeight = 6;

    const drawNote = (note: Note) => {
      if (note == this.selectedNote) {
        p.fill(0, 204, 255);
      }
      else {
        p.fill(0, 102, 153);
      }
      const x0 = viewport.mapX(note.startTime, p);
      const y0 = viewport.mapY(note.pitch, p) + noteHeight / 2;
      const x1 = viewport.mapX(note.endTime, p);
      p.rect(x0, y0, x1 - x0, noteHeight);
    };

    if (this.isDragging) {
        drawNote(this.getDrawingNote(p, viewport));
    }

    for (const note of this.notes) {
        drawNote(note);
    }
  }
}
