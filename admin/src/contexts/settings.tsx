import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { Loader, Box } from '@strapi/design-system';
import FetchSettings, { Output as OutputFetchSettings } from '../core/usecases/fetchSettings';
import Registry from '../core/di/registry';
import AppSettingsUpdated, { AppSettingsUpdatedData } from '../core/events/appSettingsUpdated';
import { Subscription } from '../core/mediator/mediator';

type SettingsProviderProps = {
  children: ReactNode;
};

type SettingsContextData = {
  provide(module: string): Record<string, any>;
};

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [settings, setSettings] = useState<OutputFetchSettings[]>([]);
  const [fetchInProgress, setFetchInProgress] = useState(true);

  async function fetch(): Promise<void> {
    const fetchSettings = new FetchSettings();
    const outputFetchSettings = await fetchSettings.execute();
    setSettings(outputFetchSettings);
    setFetchInProgress(false);
  }

  function update(data: AppSettingsUpdatedData): void {
    const mappedSettings: OutputFetchSettings[] = settings.map((setting: OutputFetchSettings) => {
      if (setting.module === data.module) {
        setting.settings[data.property] = data.value;
      }
      return setting;
    });
    setSettings(mappedSettings);
  }

  function provide(module: string): Record<string, any> {
    const config = settings.find((setting) => setting.module === module);
    if (!config) throw new Error('Module not found: ' + module);
    return config.settings;
  }

  useEffect(() => {
    fetch();
  }, []);

  useEffect(() => {
    const subscription: Subscription = Registry.getInstance()
      .inject('mediator')
      .subscribe(AppSettingsUpdated.id, update);
    return () => subscription.unsubscribe();
  }, [settings]);

  return (
    <SettingsContext.Provider
      value={{
        provide,
      }}
    >
      {!fetchInProgress && children}
      {fetchInProgress && (
        <Box
          display="flex"
          style={{ justifyContent: 'center', alignItems: 'center', height: '100vh' }}
        >
          <Loader />
        </Box>
      )}
    </SettingsContext.Provider>
  );
}

export const SettingsContext = createContext({} as SettingsContextData);

export function useSettings() {
  return useContext(SettingsContext);
}
