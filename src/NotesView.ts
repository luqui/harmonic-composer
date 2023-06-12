import p5 from "p5";
import {QuantizationGrid} from "./QuantizationGrid";
import {Viewport} from "./Viewport";


interface Note {
  startTime: number;
  endTime: number;
  pitch: number;
}

interface Point {
  x: number;
  y: number;
}


export class NotesView {
  private quantizationGrid: QuantizationGrid;
  private notes: Note[];
  private isDragging: boolean;
  private dragStart: Point;

  constructor(quantizationGrid: QuantizationGrid) {
    this.quantizationGrid = quantizationGrid;
    this.notes = [];
    this.isDragging = false;
    this.dragStart = null;
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
    this.isDragging = true;
    this.dragStart = this.getMouseCoords(p, viewport);
  }

  handleMouseReleased(p: p5, viewport: Viewport): void {
    if (this.isDragging) {
      this.notes.push(this.getDrawingNote(p, viewport));
      this.isDragging = false;
    }
  }

  draw(p: p5, viewport: Viewport): void {
    const noteHeight = 6;

    const drawNote = (note: Note) => {
      p.fill(0, 102, 153);
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
