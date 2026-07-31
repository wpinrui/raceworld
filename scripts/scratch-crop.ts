import sharp from 'sharp'

const [src, left, top, width, height, out] = process.argv.slice(2)
sharp(src)
  .extract({ left: +left, top: +top, width: +width, height: +height })
  .resize(+width * 4)
  .toFile(out)
  .then(() => console.log(out))
