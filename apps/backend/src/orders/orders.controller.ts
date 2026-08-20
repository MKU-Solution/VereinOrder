import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async createOrder(@Request() req: any, @Body() body: any) {
    const userId = req.user?.userId;
    return this.ordersService.createOrder(userId, body);
  }

  @Get('unpaid')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async getUnpaidOrders(@Query('eventId') eventId: string) {
    return this.ordersService.getUnpaidOrders(eventId);
  }

  @Post(':id/payments')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async addPayments(
    @Request() req: any,
    @Param('id') id: string,
    @Body('payments') payments: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[]
  ) {
    const userId = req.user?.userId;
    return this.ordersService.addPaymentsToOrder(id, payments, userId);
  }

  @Post(':id/reprint')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER', 'STATION')
  async reprintOrder(
    @Request() req: any,
    @Param('id') id: string
  ) {
    const userId = req.user?.userId;
    return this.ordersService.reprintOrder(id, userId);
  }

  @Post(':id/cancel')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async cancelOrder(
    @Request() req: any,
    @Param('id') id: string,
    @Body('reason') reason: string
  ) {
    const userId = req.user?.userId;
    return this.ordersService.cancelOrder(id, reason, userId);
  }

  @Post('items/:itemId/cancel')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async cancelOrderItem(
    @Request() req: any,
    @Param('itemId') itemId: string,
    @Body('reason') reason: string
  ) {
    const userId = req.user?.userId;
    return this.ordersService.cancelOrderItem(itemId, reason, userId);
  }

  @Patch(':id/priority')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER', 'STATION')
  async updatePriority(
    @Param('id') id: string,
    @Body('isPriority') isPriority: boolean
  ) {
    return this.ordersService.updatePriority(id, isPriority);
  }
}
