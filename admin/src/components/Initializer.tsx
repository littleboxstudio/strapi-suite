import { useEffect, useRef } from 'react';
import config from '../core/config';

type InitializerProps = {
  setPlugin: (id: string) => void;
};

const Initializer = ({ setPlugin }: InitializerProps) => {
  const ref = useRef(setPlugin);

  useEffect(() => {
    ref.current(config.pluginId);
  }, []);

  return null;
};

export { Initializer };
