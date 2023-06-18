import {ExactNumberType} from "exactnumber";

type Version0 = {
    notes: {
        startTime: number,
        endTime: number,
        pitch: string,
        velocity: number,
    }[],
}

export type Note = {
    startTime: number,
    endTime: number,
    pitch: string,
    velocity: number,
}

export type Score = {
     notes: Note[],
}

export function loadScore(doc: object): Score {
    if (! ('version' in doc)) { // version 0
        return (doc as Version0);
    }
    else {
        throw Error("Load error: unsupported version or corrupt document");
    }
}
