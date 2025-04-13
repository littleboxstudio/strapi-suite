import Registry from '../di/registry';
import TranslationGateway from '../gateways/translationGateway';

export default class FetchParameters {
	translationGateway: TranslationGateway;
		
  constructor() {
    this.translationGateway = Registry.getInstance().inject("translationGateway");
  }
	
  async execute(): Promise<Output[]> {
    const result = await this.translationGateway.fetch();
    const output = result.map((data: any) => ({
      id: data.id,
      documentId: data.documentId,
      uid: data.uid,
      translation: data.translation,
      locale: data.locale,
    }));
    return output;
	}
}

export type Output = {
  id: number;
  documentId: string;
  uid: string;
  translation: string;
  locale: string;
}