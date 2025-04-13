interface SlugHandler {
  setNext(handler: SlugHandler): SlugHandler;
  handle(text: string): string;
}

abstract class AbstractSlugHandler implements SlugHandler {
  private nextHandler: SlugHandler | null = null;

  public setNext(handler: SlugHandler): SlugHandler {
    this.nextHandler = handler;
    return handler;
  }

  public handle(text: string): string {
    if (this.nextHandler) {
      return this.nextHandler.handle(this.process(text));
    }
    return this.process(text);
  }

  protected abstract process(text: string): string;
}

class LowercaseHandler extends AbstractSlugHandler {
  protected process(text: string): string {
    return text.toLowerCase();
  }
}

class AccentRemovalHandler extends AbstractSlugHandler {
  protected process(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
}

class SpecialCharsHandler extends AbstractSlugHandler {
  protected process(text: string): string {
    return text.replace(/[^a-z0-9-]+/g, '-');
  }
}

class TrimHyphensHandler extends AbstractSlugHandler {
  protected process(text: string): string {
    return text.replace(/^-+|-+$/g, '');
  }
}

class MultipleHyphensHandler extends AbstractSlugHandler {
  protected process(text: string): string {
    return text.replace(/-+/g, '-');
  }
}

class LengthLimitHandler extends AbstractSlugHandler {
  private maxLength: number;

  constructor(maxLength: number = 100) {
    super();
    this.maxLength = maxLength;
  }

  protected process(text: string): string {
    if (text.length > this.maxLength) {
      const truncated = text.substring(0, this.maxLength);
      return truncated.replace(/-+$/g, '');
    }
    return text;
  }
}

const convertToSlug = (text: string, maxLength: number = 100): string => {
  if (!text) return "";
  const chain = new LowercaseHandler();
  const accentHandler = new AccentRemovalHandler();
  const specialCharsHandler = new SpecialCharsHandler();
  const trimHandler = new TrimHyphensHandler();
  const multipleHyphensHandler = new MultipleHyphensHandler();
  const lengthHandler = new LengthLimitHandler(maxLength);
  chain
    .setNext(accentHandler)
    .setNext(specialCharsHandler)
    .setNext(trimHandler)
    .setNext(multipleHyphensHandler)
    .setNext(lengthHandler);
  return chain.handle(text);
}

export { convertToSlug };
