// A barrel that ALSO declares its own callable, plus stars in another file.
// The local declaration must keep precedence over the star fan-out.
export const localHelper = (): void => {
  // body intentionally trivial
};

export * from './deep-impl';
