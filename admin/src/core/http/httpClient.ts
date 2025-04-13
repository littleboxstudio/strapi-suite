import axios from "axios";
import { getFetchClient } from '@strapi/strapi/admin';

export default interface HttpClient {
  get (url: string): Promise<any>;
  post(url: string, body: any): Promise<any>;
  put(url: string, body: any): Promise<any>;
  delete(url: string, body?: any): Promise<any>;
}

export class AxiosAdapter implements HttpClient {
    
    async get(url: string): Promise<any> {
      const response = await axios.get(url);
      return response.data;
    }
    
    async post(url: string, body: any): Promise<any> {
      const response = await axios.post(url, body);
      return response.data;
    }

    async put(url: string, body: any): Promise<any> {
      const response = await axios.put(url, body);
      return response.data;
    }
  
    async delete(url: string, body?: any): Promise<any> {
      const response = await axios.delete(url, { data: body });
      return response.data;
    }
}

export class StrapiAdapter implements HttpClient {
  async get(url: string): Promise<any> {
    const { get } = getFetchClient();
    const data = await get(url);
    return data.data;
  }

  async post(url: string, body: any): Promise<any> {
    const { post } = getFetchClient();
    const data = await post(url, body);
    return data.data;
  } 

  async put(url: string, body: any): Promise<any> {
    const { put } = getFetchClient();
    const data = await put(url, body);
    return data.data;
  } 

  async delete(url: string, body: any): Promise<any> {
    const { del } = getFetchClient();
    const data = await del(url, {
      params: body
    });
    return data.data;
  } 
}