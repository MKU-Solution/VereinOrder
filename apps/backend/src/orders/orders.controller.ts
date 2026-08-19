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
  async createOrder(@Request() req, @Body() body: any) {
    const userId = req.user.userId;
    return this.ordersService.createOrder(userId, body);
  }

  @Get('unpaid')
  @Roles('ADMINISTRATOR', 'WAITER', 'CASHIER')
  async getUnpaidOrders(@Query('eventId') eventId: string) {
    return this.ordersService.getUnpaidOrders(eventId);
  }

  @Post(':id/payments')
  @Roles('ADMINISTRATOR', 'CASHIER', 'WAITER')
  async addPayments(
    @Request() req,
    @Param('id') id: string,
    @Body('payments') payments: { amount: number, method: 'CASH' | 'CARD' | 'VOUCHER' }[]
  ) {
    const userId = req.user?.userId || null;
    return this.ordersService.addPaymentsToOrder(id, payments, userId);
  }

  @Post(':id/cancel')
  async cancelOrder(
    @Request() req,
    @Param('id') id: string,
    @Body('reason') reason?: string
  ) {
    const userId = req.user?.userId || null;
    return this.ordersService.cancelOrder(id, userId, reason);
  }

  @Post('items/:itemId/cancel')
  async cancelOrderItem(
    @Request() req,
    @Param('itemId') itemId: string,
    @Body('reason') reason?: string
  ) {
    const userId = req.user?.userId || null;
    return this.ordersService.cancelOrderItem(itemId, userId, reason);
  }

  @Patch(':id/priority')
  @Roles('ADMINISTRATOR', 'STATION', 'WAITER')
  async togglePriority(
    @Request() req,
    @Param('id') id: string,
    @Body('isPriority') isPriority: boolean
  ) {
    const userId = req.user?.userId || null;
    return this.ordersService.toggleOrderPriority(id, isPriority, userId);
  }
}
