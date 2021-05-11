import { Liquid } from 'liquidjs';
import { logger } from './logger';
import rp from 'request-promise';

const engine = new Liquid({
  root: 'templates',
  extname: '.liquid',
});

export let token: string | null;

export async function getToken(
  proxy: string,
  userId: string,
  apiKey: string,
  expiry = 1
): Promise<string | null> {
  try {
    if (token) return token;
    const res = await rp({
      method: 'POST',
      proxy,
      uri: `https://kakaoapi.aligo.in/akv10/token/create/${expiry}/h`,
      formData: { apikey: apiKey, userid: userId },
      json: true,
    });

    if (res.code !== 0) throw Error(`오류가 발생하였습니다.`);
    if (!res.token) throw Error('서버에서 토큰을 반환하지 않았습니다.');
    setTimeout(() => (token = null), expiry * 3600 * 900);
    token = res.token;
    return token;
  } catch (err) {
    throw Error(`서버에서 잘못된 값을 반환하였습니다.`);
  }
}

export async function send(
  phone: string,
  template: string,
  title: string,
  props: any,
  buttons?: any
): Promise<void> {
  const {
    ALIGO_PROXY,
    ALIGO_IDENTIFIER,
    ALIGO_SENDER_KEY,
    ALIGO_SECRET,
    ALIGO_SENDER,
  } = process.env;
  if (
    !ALIGO_PROXY ||
    !ALIGO_SENDER_KEY ||
    !ALIGO_IDENTIFIER ||
    !ALIGO_SECRET ||
    !ALIGO_SENDER
  ) {
    throw Error('문자를 발송할 수 없습니다.');
  }

  if (buttons && !(buttons instanceof Array)) {
    buttons = Object.entries(buttons).map(([name, url]) => ({
      type: 'WL',
      name,
      linkMo: url,
      linkPc: url,
    }));
  }

  const token = await getToken(ALIGO_PROXY, ALIGO_IDENTIFIER, ALIGO_SECRET);
  const renderer = await engine.renderFile(template, props);
  const rendererSMS = await engine.renderFile(`${template}_SMS`, props);
  const options = {
    method: 'POST',
    url: 'http://kakaoapi.aligo.in/akv10/alimtalk/send/',
    proxy: ALIGO_PROXY,
    json: true,
    formData: {
      apikey: ALIGO_SECRET,
      userid: ALIGO_IDENTIFIER,
      token,
      senderkey: ALIGO_SENDER_KEY,
      tpl_code: template,
      sender: ALIGO_SENDER,
      receiver_1: `0${phone.substr(3)}`,
      subject_1: title,
      failover: 'Y',
      message_1: renderer,
      fsubject_1: title,
      fmessage_1: rendererSMS,
      testmode_yn: process.env.NODE_ENV !== 'prod' ? 'true' : 'false',
      button_1: JSON.stringify({ button: buttons }),
    },
  };

  logger.info(JSON.stringify(options));
  const res = await rp(options);
  logger.info(JSON.stringify(res));
}
