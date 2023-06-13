import p5 from "p5";

export interface Viewport {
  mapX(x: number, p: p5): number;
  mapXinv(x: number, p: p5): number;
  mapY(y: number, p: p5): number;
  mapYinv(y: number, p:p5): number;
}

export class LinearViewport {
  private minX: number;
  private minY: number;
  private maxX: number;
  private maxY: number;

  constructor(minX: number, minY: number, maxX: number, maxY: number) {
    this.minX = minX;
    this.minY = minY;
    this.maxX = maxX;
    this.maxY = maxY;
  }

  mapX(x: number, p: p5): number {
    return p.map(x, this.minX, this.maxX, 0, p.width);
  }

  mapXinv(x: number, p: p5): number {
    return p.map(x, 0, p.width, this.minX, this.maxX);
  }

  mapY(y: number, p: p5): number {
    return p.map(y, this.minY, this.maxY, p.height, 0);
  }

  mapYinv(y: number, p:p5): number {
    return p.map(y, p.height, 0, this.minY, this.maxY);
  }
}

export class LogViewport {
  private minX: number;
  private minNote: number;
  private maxX: number;
  private maxNote: number;

  constructor(minX: number, minNote: number, maxX: number, maxNote: number) {
    this.minX = minX;
    this.minNote = minNote;
    this.maxX = maxX;
    this.maxNote = maxNote;
  }
  
  mapX(x: number, p: p5): number {
    return p.map(x, this.minX, this.maxX, 0, p.width);
  }

  mapXinv(x: number, p: p5): number {
    return p.map(x, 0, p.width, this.minX, this.maxX);
  }
  
  mapY(y: number, p: p5): number {

    let note = 12 * Math.log2(y / 440) + 69;
    return p.map(note, this.minNote, this.maxNote, p.height, 0);
  }

  mapYinv(y: number, p:p5): number {
    let ynorm = p.map(y, p.height, 0, this.minNote, this.maxNote);
    let hz = 440 * Math.pow(2, (ynorm - 69) / 12);
    return hz;
  }
}
