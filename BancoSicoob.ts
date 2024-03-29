export class SicoobBanking implements BrazilBanking {
  private readonly httpInstancePix: AxiosInstance;
  private readonly httpInstanceAuthPix: AxiosInstance;

  public constructor(
    private readonly credentialRepository: CredentialDatabase
  ) {
    this.httpInstanceAuthPix = axios.create({ baseURL: "https://auth.sicoob.com.br" });
    this.httpInstancePix = axios.create({ baseURL: "https://api.sicoob.com.br" });
  }

  public async handleOAuthToken(credential: Credential): Promise<Credential> {
    const bodyRequest = qs.stringify({
      client_id: credential.clientId,
      scope: "cob.read cob.write cobv.write cobv.read lotecobv.write lotecobv.read pix.write pix.read webhook.read webhook.write payloadlocation.write payloadlocation.read",
      grant_type: "client_credentials"
    });
    const response = await this.httpInstanceAuthPix.post("/auth/realms/cooperado/protocol/openid-connect/token", bodyRequest, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      httpsAgent: CertificateLoader.handleHttpsAgent(credential)
    });
    const currentCredential = await this.credentialRepository.findById(credential.id);
    currentCredential.refreshTokenExpireAt = new Date();
    currentCredential.refreshToken = response.data.access_token;
    return this.credentialRepository.save(currentCredential);
  }

  public isOauthExpired(credential: Credential): boolean {
    const updatedAtTimestamp = new Date(credential.refreshTokenExpireAt).getTime();
    const currentTimestamp = new Date().getTime();
    const minutesDifference = (currentTimestamp - updatedAtTimestamp) / (1000 * 60);
    return minutesDifference > 4; // minutes
  }

  public async findPixCharge(credential: Credential, pix: Pix): Promise<Pix> {
    const headers = {
      client_id: credential.clientId,
      Authorization: "Bearer " + credential.refreshToken
    };
    if (this.isOauthExpired(credential)) {
      const accessTokenCredential = await this.handleOAuthToken(credential);
      headers.Authorization = `Bearer ${accessTokenCredential.refreshToken}`;
    }
    const response = await this.httpInstancePix.get("/pix/api/v2/cob/" + pix.transactionId, {
      headers,
      httpsAgent: CertificateLoader.handleHttpsAgent(credential)
    });
    pix.status = BankingResponse.handlePixPaymentStatus(response.data);
    console.log("FIND", response.data);
    return pix;
  }

  public async createPixCharge(credential: Credential, pix: Pix): Promise<Pix> {
    const headers = {
      client_id: credential.clientId,
      Authorization: "Bearer " + credential.refreshToken
    };
    if (this.isOauthExpired(credential)) {
      const accessTokenCredential = await this.handleOAuthToken(credential);
      headers.Authorization = `Bearer ${accessTokenCredential.refreshToken}`;
    }
    const bodyRequest = BankingResponse.pixChargeInputParser(pix);
    const response = await this.httpInstancePix.post("/pix/api/v2/cob", bodyRequest, {
      headers,
      httpsAgent: CertificateLoader.handleHttpsAgent(credential)
    });
    return BankingResponse.handlePixBankingResponse(pix, response.data);
  }

  public async createPixWebhook(credential: Credential, listener: Listener): Promise<any> {
    const headers = {
      client_id: credential.clientId,
      Authorization: "Bearer " + credential.refreshToken
    };

    if (this.isOauthExpired(credential)) {
      const accessTokenCredential = await this.handleOAuthToken(credential);
      headers.Authorization = `Bearer ${accessTokenCredential.refreshToken}`;
    }
    await this.deletePixWebhook(credential, listener);
    const bodyRequest = { webhookUrl: listener.endpoint };
    const response = await this.httpInstancePix.put("/pix/api/v2/webhook/" + credential.pixKey, bodyRequest, {
      headers,
      httpsAgent: CertificateLoader.handleHttpsAgent(credential)
    });

    return response.headers["x-global-transaction-id"];
  }

  public async deletePixWebhook(credential: Credential, listener: Listener): Promise<any> {
    const headers = {
      client_id: credential.clientId,
      Authorization: "Bearer " + credential.refreshToken
    };

    if (this.isOauthExpired(credential)) {
      const accessTokenCredential = await this.handleOAuthToken(credential);
      headers.Authorization = `Bearer ${accessTokenCredential.refreshToken}`;
    }
    const httpsAgent = CertificateLoader.handleHttpsAgent(credential);
    const web = await this.httpInstancePix.get("/pix/api/v2/webhook", { headers, httpsAgent });

    for (const webhook of web.data.webhooks) {
      await this.httpInstancePix.delete("/pix/api/v2/webhook/" + webhook.chave, { headers, httpsAgent }).catch(console.log);
    }
    return true;
  }

  public decodeWebhookEvent(data: any): BrazilBankingWebhook {
    data.event = WebhookBankingEventEnum.PIX;
    return data;
  }

  public async createBoletoCharge(credential: Credential, boleto: Boleto): Promise<Boleto> {
    throw new Error("Method not implemented.");
  }
}
