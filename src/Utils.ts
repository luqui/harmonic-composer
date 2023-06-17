export function intervalIntersects(a1: number, b1: number, a2: number, b2:number): boolean {
  return ! (a2 > b1 || a1 > b2);
}

export function dedup<T>(xs: T[]): T[] {
    return [...new Set(xs)];
}

