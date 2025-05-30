import {BindingsErrorInterface} from '@noelneu/bindings-interface'

export class BindingsError extends Error implements BindingsErrorInterface {
  canceled: boolean
  constructor(message: string, { canceled = false } = {}) {
    super(message)
    this.canceled = canceled
  }
}
