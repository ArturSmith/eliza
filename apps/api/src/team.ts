import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { employeeSchema, employeeProfileSchema, pinSchema } from '@eliza/contracts';
import { AuthModule } from './auth.js';
import { Database } from './database.js';
import {
  AccessGuard,
  type AuthRequest,
  Require,
  parse,
  passwordHash,
  token,
  hash,
} from './security.js';
import { Operations, audit } from './operations.js';
@Controller('team')
@UseGuards(AccessGuard)
export class TeamController {
  constructor(
    private database: Database,
    private operations: Operations,
  ) {}
  @Get('roles') @Require('team.manage') async roles(@Req() req: AuthRequest) {
    return (
      await this.database.pool.query(
        'SELECT id,name,permissions FROM roles WHERE store_id=$1 ORDER BY name',
        [req.context.store.id],
      )
    ).rows;
  }
  @Post() @Require('team.manage') async create(@Body() input: unknown, @Req() req: AuthRequest) {
    const body = parse(employeeSchema, input);
    if ((body.email && !body.password) || (!body.email && body.password))
      throw new BadRequestException(
        'Provide both email and password for management login, or leave both blank for PIN-only access.',
      );
    const pin = await passwordHash(body.pin),
      password = await passwordHash(body.password || token());
    const qrCredential = 'ELIZA-STAFF:' + token();
    const { user, store, device } = req.context;
    return this.operations.transaction(async (client) => {
      const roleIds = [...new Set(body.roleIds?.length ? body.roleIds : [body.roleId])];
      if (!roleIds.includes(body.roleId))
        throw new BadRequestException('Primary role must be assigned.');
      const role = (
        await client.query('SELECT id FROM roles WHERE id=$1 AND store_id=$2', [
          body.roleId,
          store.id,
        ])
      ).rows[0];
      if (
        !role ||
        (
          await client.query('SELECT id FROM roles WHERE id=ANY($1::uuid[]) AND store_id=$2', [
            roleIds,
            store.id,
          ])
        ).rowCount !== roleIds.length
      )
        throw new BadRequestException('Choose roles from this store.');
      const employee = (
        await client.query(
          'INSERT INTO employees(store_id,role_id,name,email,password_hash,employee_code,pin_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            store.id,
            body.roleId,
            body.name,
            body.email ? body.email.toLowerCase() : null,
            password,
            body.employeeCode,
            pin,
          ],
        )
      ).rows[0];
      await client.query(
        'UPDATE employees SET first_name=$2,last_name=$3,birth_year=$4,gender=$5,phone=$6 WHERE id=$1',
        [
          employee.id,
          body.firstName || null,
          body.lastName || null,
          body.birthYear || null,
          body.gender || null,
          body.phone || null,
        ],
      );
      await client.query(
        'INSERT INTO employee_roles(employee_id,role_id,store_id) SELECT $1,unnest($2::uuid[]),$3',
        [employee.id, roleIds, store.id],
      );
      await client.query(
        'INSERT INTO employee_qr_credentials(employee_id,store_id,token_hash) VALUES($1,$2,$3)',
        [employee.id, store.id, hash(qrCredential)],
      );
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Employee created',
        employee.id,
        { name: body.name, employeeCode: body.employeeCode, roleId: body.roleId },
      );
      return { id: employee.id, qrCredential };
    });
  }
  @Post(':id/qr') @Require('team.manage') async issueQr(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    const { user, store, device } = req.context;
    const qrCredential = 'ELIZA-STAFF:' + token();
    return this.operations.transaction(async (client) => {
      const employee = (
        await client.query('SELECT id FROM employees WHERE id=$1 AND store_id=$2', [id, store.id])
      ).rows[0];
      if (!employee) throw new NotFoundException('Employee not found.');
      const issued = await client.query(
        'INSERT INTO employee_qr_credentials(employee_id,store_id,token_hash) VALUES($1,$2,$3) ON CONFLICT (employee_id) DO NOTHING RETURNING employee_id',
        [id, store.id, hash(qrCredential)],
      );
      if (!issued.rowCount)
        throw new BadRequestException('This employee already has a QR credential.');
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Employee QR issued',
        id,
        {},
      );
      return { qrCredential };
    });
  }
  @Patch(':id') @Require('team.manage') async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: unknown,
    @Req() req: AuthRequest,
  ) {
    const body = parse(
      z.object({
        ...employeeProfileSchema.shape,
        name: z.string().trim().min(1).max(120),
        employeeCode: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,20}$/)
          .transform((v) => v.toUpperCase()),
        roleId: z.uuid(),
        active: z.boolean(),
        roleIds: z.array(z.uuid()).min(1).optional(),
        pin: z.union([pinSchema, z.literal('')]).default(''),
      }),
      input,
    );
    const pin = body.pin ? await passwordHash(body.pin) : null;
    const { user, store, device } = req.context;
    return this.operations.transaction(async (client) => {
      const old = (
        await client.query('SELECT * FROM employees WHERE id=$1 AND store_id=$2 FOR UPDATE', [
          id,
          store.id,
        ])
      ).rows[0];
      if (!old) throw new NotFoundException('Employee not found.');
      const oldRoles = (
        await client.query('SELECT role_id FROM employee_roles WHERE employee_id=$1', [id])
      ).rows.map((r) => r.role_id as string);
      const roleIds = [
        ...new Set(
          body.roleIds?.length
            ? body.roleIds
            : [body.roleId, ...oldRoles.filter((roleId) => roleId !== old.role_id)],
        ),
      ];
      if (!roleIds.includes(body.roleId))
        throw new BadRequestException('Primary role must be assigned.');
      if (
        id === user.id &&
        (!body.active ||
          body.roleId !== old.role_id ||
          roleIds.length !== oldRoles.length ||
          roleIds.some((roleId) => !oldRoles.includes(roleId)))
      )
        throw new BadRequestException(
          'You cannot disable your own account or change your own role.',
        );
      if (
        (
          await client.query('SELECT id FROM roles WHERE id=ANY($1::uuid[]) AND store_id=$2', [
            roleIds,
            store.id,
          ])
        ).rowCount !== roleIds.length
      )
        throw new BadRequestException('Choose a role from this store.');
      if (
        !body.active &&
        (await client.query("SELECT id FROM shifts WHERE employee_id=$1 AND status='open'", [id]))
          .rowCount
      )
        throw new BadRequestException(
          'Close this employee’s open shift before disabling their account.',
        );
      await client.query(
        'UPDATE employees SET name=$1,employee_code=$2,role_id=$3,active=$4,pin_hash=COALESCE($5,pin_hash) WHERE id=$6',
        [body.name, body.employeeCode, body.roleId, body.active, pin, id],
      );
      await client.query(
        'UPDATE employees SET first_name=$2,last_name=$3,birth_year=$4,gender=$5,phone=$6 WHERE id=$1',
        [
          id,
          body.firstName === undefined ? old.first_name : body.firstName || null,
          body.lastName === undefined ? old.last_name : body.lastName || null,
          body.birthYear === undefined ? old.birth_year : body.birthYear || null,
          body.gender === undefined ? old.gender : body.gender || null,
          body.phone === undefined ? old.phone : body.phone || null,
        ],
      );
      await client.query('DELETE FROM employee_roles WHERE employee_id=$1', [id]);
      await client.query(
        'INSERT INTO employee_roles(employee_id,role_id,store_id) SELECT $1,unnest($2::uuid[]),$3',
        [id, roleIds, store.id],
      );
      const rolesChanged =
        old.role_id !== body.roleId ||
        roleIds.length !== oldRoles.length ||
        roleIds.some((roleId) => !oldRoles.includes(roleId));
      if (pin || !body.active || rolesChanged)
        await client.query('DELETE FROM pos_sessions WHERE employee_id=$1', [id]);
      if (pin || !body.active || rolesChanged)
        await client.query('DELETE FROM price_tag_sessions WHERE employee_id=$1', [id]);
      await audit(
        client,
        { storeId: store.id, employeeId: user.id, deviceId: device.id },
        'Employee updated',
        id,
        {
          before: {
            name: old.name,
            employeeCode: old.employee_code,
            roleId: old.role_id,
            active: old.active,
          },
          after: {
            name: body.name,
            employeeCode: body.employeeCode,
            roleId: body.roleId,
            active: body.active,
          },
          profileFieldsChanged: ['firstName', 'lastName', 'birthYear', 'gender', 'phone'].filter(
            (key) => {
              const columns = {
                firstName: 'first_name',
                lastName: 'last_name',
                birthYear: 'birth_year',
                gender: 'gender',
                phone: 'phone',
              };
              const field = key as keyof typeof columns;
              return body[field] !== undefined && (body[field] || null) !== old[columns[field]];
            },
          ),
          pinReset: !!pin,
        },
      );
      return { ok: true };
    });
  }
}
@Module({ imports: [AuthModule], controllers: [TeamController], providers: [Operations] })
export class TeamModule {}
