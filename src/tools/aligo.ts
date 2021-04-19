import { Liquid } from 'liquidjs';
// import rp from 'request-promise';

const engine = new Liquid({
  root: 'templates',
  extname: '.liquid',
});

export async function send(
  phone: string,
  template: string,
  props: any
): Promise<boolean> {
  const {
    ALIGO_PROXY,
    ALIGO_IDENTIFIER,
    ALIGO_SECRET,
    ALIGO_SENDER,
  } = process.env;

  if (!ALIGO_PROXY || !ALIGO_IDENTIFIER || !ALIGO_SECRET || !ALIGO_SENDER) {
    throw Error('문자를 발송할 수 없습니다.');
  }

  const renderer = await engine.renderFile(template, props);
  console.log(renderer);
  //   const res = await rp({
  //   method: 'POST',
  //   url: 'http://apis.aligo.in',
  //   proxy: ALIGO_PROXY,
  //   json: true,
  //   formData: {
  //     user_id: ALIGO_IDENTIFIER,
  //     key: ALIGO_SECRET,
  //     sender: ALIGO_SENDER,
  //     receiver: phone.substr(3),
  //     msg: renderer,
  //     testmode_yn: process.env.NODE_ENV !== 'prod' ? 'true' : 'false',
  //   },
  // });

  // return res.result_code === 1;
  return true;
}
