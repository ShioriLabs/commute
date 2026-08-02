// Builds the twgl ProgramInfos for each draw pass plus the shared unit-quad
// (billboard corners). Following the house pattern in apps/web's
// map-renderer-webgl.ts: one ProgramInfo per pass, and per-pass VertexArrayInfo
// built in instanced.ts to avoid attribute-state bleed between passes.
import * as twgl from 'twgl.js'
import {
  FIELD_VS,
  FIELD_FS,
  DOT_VS,
  DOT_FS,
  STATION_VS,
  STATION_FS,
  TRAIN_VS,
  TRAIN_FS,
  JPM_VS,
  JPM_FS
} from './shaders'

export interface Programs {
  field: twgl.ProgramInfo
  dot: twgl.ProgramInfo
  station: twgl.ProgramInfo
  train: twgl.ProgramInfo
  jpm: twgl.ProgramInfo
}

export function createPrograms(gl: WebGL2RenderingContext): Programs {
  const field = twgl.createProgramInfo(gl, [FIELD_VS, FIELD_FS])
  const dot = twgl.createProgramInfo(gl, [DOT_VS, DOT_FS])
  const station = twgl.createProgramInfo(gl, [STATION_VS, STATION_FS])
  const train = twgl.createProgramInfo(gl, [TRAIN_VS, TRAIN_FS])
  const jpm = twgl.createProgramInfo(gl, [JPM_VS, JPM_FS])

  return { field, dot, station, train, jpm }
}
