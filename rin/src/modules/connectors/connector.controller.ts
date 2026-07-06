import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConnectorService } from './connector.service';
import { CreateConnectorDto } from './dto';
import { MerchantGuard } from '../../common/auth/merchant.guard';
import { CurrentMerchant } from '../../common/auth/current-user.decorator';
import { MerchantPrincipal } from '../../common/auth/token.types';

@ApiTags('connectors (merchant)')
@ApiBearerAuth()
@UseGuards(MerchantGuard)
@Controller('v1/connectors')
export class ConnectorController {
  constructor(private readonly connectors: ConnectorService) {}

  @Post()
  @ApiOperation({ summary: 'Register a CRM/POS/ERP connector (Integration Gateway).' })
  async create(@CurrentMerchant() m: MerchantPrincipal, @Body() dto: CreateConnectorDto) {
    return this.connectors.create(m.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My connectors.' })
  async list(@CurrentMerchant() m: MerchantPrincipal) {
    return { connectors: await this.connectors.list(m.id) };
  }

  @Get(':id/logs')
  @ApiOperation({ summary: 'Normalized sync log for a connector.' })
  async logs(@CurrentMerchant() m: MerchantPrincipal, @Param('id') id: string) {
    return { logs: await this.connectors.syncLogs(m.id, id) };
  }

  @Post('import/receipts')
  @ApiConsumes('text/csv')
  @ApiOperation({
    summary:
      'Bulk-import receipts from CSV. Columns: grantId,externalId,purchasedAt,itemName,unitPriceMinor,quantity,warrantyMonths,returnDays',
  })
  async importReceipts(@CurrentMerchant() m: MerchantPrincipal, @Req() req: any) {
    const csv: string = typeof req.body === 'string' ? req.body : (req.body?.csv ?? '');
    return this.connectors.importReceiptsCsv(m.id, csv);
  }
}
