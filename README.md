# LINE GROUP GUARDIAN

บอทช่วยดูแลกลุ่ม LINE ด้วย LINE Messaging API และ Render

## ความสามารถ
- ตรวจจับลิงก์
- ตรวจจับคำต้องห้าม (แก้ไขได้ด้วยคำสั่งแอดมิน)
- ตรวจจับข้อความถี่เกินกำหนด
- แจ้งเตือนและบันทึกเหตุการณ์
- เปิด/ปิดระบบป้องกัน
- จำกัดคำสั่งให้เฉพาะ LINE User ID ที่กำหนดใน `ADMIN_USER_IDS`

## ติดตั้งบน Render
1. Render > New > Web Service > เชื่อม GitHub repository นี้
2. Build Command: `npm install`; Start Command: `npm start`
3. ตั้ง Environment Variables: `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `ADMIN_USER_IDS` (LINE User ID รูปแบบ `U...` ไม่ใช่ LINE ID ที่ใช้ค้นหาเพื่อน)
4. Deploy แล้วคัดลอก URL ของบริการ เช่น `https://ชื่อบริการ.onrender.com`
5. LINE Developers > Messaging API > Webhook URL ใส่ `https://ชื่อบริการ.onrender.com/webhook`
6. เปิด Use webhook และกด Verify
7. เปิด Allow bot to join group chats แล้วเชิญบอทเข้ากลุ่ม

## คำสั่งแอดมินในกลุ่ม
- `!status` ดูสถานะและคำสั่ง
- `!guard on` เปิดระบบ
- `!guard off` ปิดระบบ
- `!bad add คำ` เพิ่มคำต้องห้าม
- `!bad remove คำ` ลบคำต้องห้าม
- `!log` ดูบันทึกล่าสุด

## หา LINE User ID ของแอดมิน
ให้บอทได้รับ webhook event จากผู้ใช้ก่อน แล้วตรวจสอบ log ของบริการหรือติดตั้งการเก็บ userId เพิ่มเติม จากนั้นนำค่า `U...` ไปใส่ `ADMIN_USER_IDS` แล้ว redeploy
หมายเหตุ: LINE ID เช่น `o3_panyatha19` ไม่ใช่ User ID สำหรับ API โดยตรง

## ข้อจำกัดสำคัญของ LINE
Messaging API ไม่ได้ให้บอทลบข้อความของสมาชิกหรือเตะสมาชิกออกจากกลุ่มโดยตรงในกรณีทั่วไป โค้ดนี้จึงเตือน บันทึก และแจ้งผู้ดูแลเพื่อดำเนินการเอง
ข้อมูล state/log เก็บใน filesystem ของบริการ หากใช้แผน/instance ที่ filesystem ไม่ถาวร ข้อมูลอาจหายเมื่อ restart หรือ redeploy ควรเพิ่ม persistent disk หรือฐานข้อมูลสำหรับการใช้งานระยะยาว

## ความปลอดภัย
ห้ามโพสต์ Channel Access Token หรือ Channel Secret ในแชต/พื้นที่สาธารณะ ให้ใส่เฉพาะใน Environment Variables ของ Render เท่านั้น
