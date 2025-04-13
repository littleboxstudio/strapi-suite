interface Handler {
  setNext(handler: Handler): Handler;
  handle(value: unknown, checkEmpty: boolean): boolean;
}

abstract class AbstractHandler implements Handler {
  private nextHandler: Handler | null = null;

  public setNext(handler: Handler): Handler {
    this.nextHandler = handler;
    return handler;
  }

  public handle(value: unknown, checkEmpty: boolean) {
    return this.nextHandler
      ? this.nextHandler.handle(value, checkEmpty)
      : true;
  }
}

class StringHandler extends AbstractHandler {
  public handle(value: unknown, checkEmpty: boolean) {
    if (typeof value === 'string') {
      const isEmpty = value.trim() === '';
      return (checkEmpty && isEmpty) || (!checkEmpty && !isEmpty);
    }
    return super.handle(value, checkEmpty);
  }
}

class ArrayHandler extends AbstractHandler {
  public handle(value: unknown, checkEmpty: boolean) {
    if (Array.isArray(value)) {
      const isEmpty = value.length === 0;
      return (checkEmpty && isEmpty) || (!checkEmpty && !isEmpty);
    } 
    return super.handle(value, checkEmpty);
  }
}

class ObjectHandler extends AbstractHandler {
  public handle(value: unknown, checkEmpty: boolean) {
    if (
      typeof value === 'object' && 
      value !== null && 
      !Array.isArray(value)
    ) {
      const isEmpty = Object.keys(value).length === 0;
      return (checkEmpty && isEmpty) || (!checkEmpty && !isEmpty);
    }
    return super.handle(value, checkEmpty);
  }
}


function createValidationChain(): Handler {
  const stringHandler = new StringHandler();
  const arrayHandler = new ArrayHandler();
  const objectHandler = new ObjectHandler();
  stringHandler.setNext(arrayHandler);
  arrayHandler.setNext(objectHandler);
  return stringHandler;
}

const isEmpty = (value: any): boolean => {
  const chain = createValidationChain();
  const result = chain.handle(value, true);
  return result;
}

const isNotEmpty = (value: any): boolean => {
  const chain = createValidationChain();
  const result = chain.handle(value, false);
  return result;
}

export {
  isEmpty,
  isNotEmpty
};
