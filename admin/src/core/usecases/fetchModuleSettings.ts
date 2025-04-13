import FetchSettings from "./fetchSettings";

export default class FetchModuleSettings {
  constructor() {}
	
  async execute(module: string): Promise<Record<string, any>> {
    const fetchSettings = new FetchSettings();
    const outputFetchSettings = await fetchSettings.execute();
    const config = outputFetchSettings.find((setting) => setting.module === module);
    if (!config) throw new Error('Module not found: ' + module);
    return config.settings;
	}
}
