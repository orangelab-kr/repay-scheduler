import { OPCODE } from './opcode';

export class InternalError extends Error {
  public opcode: OPCODE;
  public name = 'InternalError';

  public constructor(message: string, opcode = OPCODE.ERROR) {
    super();

    this.message = message;
    this.opcode = opcode;
  }
}
